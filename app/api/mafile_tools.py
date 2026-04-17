import json
import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.config import settings
from app.database import get_db
from app.models import MafileData

router = APIRouter(prefix="/api/mafiles", tags=["mafile_tools"])


@router.get("")
async def list_mafiles():
    """List all stored mafiles."""
    mafiles_dir = settings.mafiles_dir
    if not mafiles_dir.exists():
        return []

    result = []
    for f in sorted(mafiles_dir.glob("*.mafile")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            result.append({
                "filename": f.name,
                "account_name": data.get("account_name", ""),
                "steam_id": data.get("Session", {}).get("SteamID", ""),
                "has_shared_secret": bool(data.get("shared_secret")),
                "has_identity_secret": bool(data.get("identity_secret")),
                "fully_enrolled": data.get("fully_enrolled", False),
            })
        except (json.JSONDecodeError, OSError):
            result.append({"filename": f.name, "error": "Failed to parse"})
    return result


@router.post("/upload")
async def upload_mafiles(files: list[UploadFile] = File(...)):
    """Upload multiple .mafile files."""
    settings.mafiles_dir.mkdir(parents=True, exist_ok=True)
    uploaded = 0
    errors: list[str] = []

    db = await get_db()

    for file in files:
        content = (await file.read()).decode("utf-8", errors="ignore")
        try:
            mafile = MafileData.model_validate_json(content)
            steam_id = mafile.Session.SteamID or mafile.account_name or file.filename
            dest = settings.mafiles_dir / f"{steam_id}.mafile"
            dest.write_text(content, encoding="utf-8")
            uploaded += 1

            if mafile.account_name:
                await db.execute(
                    """UPDATE accounts
                       SET mafile_path = ?, shared_secret = ?, identity_secret = ?
                       WHERE login = ?""",
                    (
                        str(dest),
                        mafile.shared_secret or "",
                        mafile.identity_secret or "",
                        mafile.account_name,
                    ),
                )
                await db.commit()
        except Exception as exc:
            errors.append(f"{file.filename}: {exc}")

    logger.info(f"Uploaded {uploaded} mafiles, {len(errors)} errors")
    return {"uploaded": uploaded, "errors": errors}


@router.get("/{filename}")
async def get_mafile(filename: str):
    """Get parsed mafile data by filename."""
    safe_name = Path(filename).name
    mafile_path = settings.mafiles_dir / safe_name
    if not mafile_path.exists() or not mafile_path.suffix == ".mafile":
        raise HTTPException(status_code=404, detail="Mafile not found")

    content = mafile_path.read_text(encoding="utf-8")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse mafile")


@router.delete("/{filename}", status_code=204)
async def delete_mafile(filename: str):
    safe_name = Path(filename).name
    mafile_path = settings.mafiles_dir / safe_name
    if not mafile_path.exists():
        raise HTTPException(status_code=404, detail="Mafile not found")
    mafile_path.unlink()


@router.get("/export/all")
async def export_all_secrets():
    """Export account_name:shared_secret:identity_secret for all mafiles."""
    mafiles_dir = settings.mafiles_dir
    if not mafiles_dir.exists():
        return []

    result = []
    for f in sorted(mafiles_dir.glob("*.mafile")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            result.append({
                "account_name": data.get("account_name", ""),
                "shared_secret": data.get("shared_secret", ""),
                "identity_secret": data.get("identity_secret", ""),
                "steam_id": data.get("Session", {}).get("SteamID", ""),
            })
        except (json.JSONDecodeError, OSError):
            pass
    return result


class ExportRequest(BaseModel):
    fields: list[str] = []
    session_fields: list[str] = []
    format: str = "flat_mafiles"  # flat_mafiles | per_account_folder | single_file
    account_ids: list[int] = []
    # Naming variables: {username} and {steamid} are replaced at export time
    folder_name_template: str = "{username}"
    mafile_name_template: str = "{steamid}.mafile"
    txt_name_template: str = "{username}.txt"
    include_txt_per_folder: bool = False
    include_global_txt: bool = False
    skip_folders: bool = False
    # Format for .txt lines: login:password:email:email_password
    txt_format: str = "{login}:{password}:{email}:{email_password}"


def _filter_mafile(data: dict, fields: list[str], session_fields: list[str]) -> dict:
    """Keep only selected top-level + Session fields from mafile JSON."""
    if not fields and not session_fields:
        return data

    filtered = {}
    for key in fields:
        if key in data and key != "Session":
            filtered[key] = data[key]

    if session_fields and "Session" in data:
        filtered["Session"] = {
            k: v for k, v in data["Session"].items() if k in session_fields
        }

    return filtered


@router.post("/export/zip")
async def export_mafiles_zip(body: ExportRequest):
    """Build a .zip with filtered mafile data, optionally limited to account IDs."""
    if not body.account_ids:
        raise HTTPException(status_code=400, detail="No account IDs provided for export")

    mafiles_dir = settings.mafiles_dir
    if not mafiles_dir.exists():
        raise HTTPException(status_code=404, detail="No mafiles directory")

    db = await get_db()

    # Load account info for naming and .txt generation
    account_map: dict[str, dict] = {}  # login -> account row
    if body.account_ids:
        placeholders = ",".join("?" * len(body.account_ids))
        cursor = await db.execute(
            f"SELECT * FROM accounts WHERE id IN ({placeholders})",
            body.account_ids,
        )
    else:
        cursor = await db.execute("SELECT * FROM accounts")
    for row in await cursor.fetchall():
        account_map[row["login"]] = dict(row)

    account_logins = set(account_map.keys()) if body.account_ids else set()

    def _resolve_template(template: str, username: str, steam_id: str) -> str:
        return template.replace("{username}", username).replace("{steamid}", steam_id)

    def _resolve_txt_line(template: str, acc: dict, mafile_data: dict | None = None) -> str:
        has_mafile_var = "{mafile}" in template
        if has_mafile_var:
            before, _, after = template.partition("{mafile}")
        else:
            before = template

        line = (
            before
            .replace("{login}", acc.get("login") or "")
            .replace("{password}", acc.get("password") or "")
            .replace("{email}", acc.get("email") or "")
            .replace("{email_password}", acc.get("email_password") or "")
            .replace("{steam_id}", acc.get("steam_id") or "")
            .replace("{proxy}", acc.get("proxy") or "")
        )
        line = line.rstrip(":")
        if has_mafile_var and mafile_data is not None:
            line += ":" + json.dumps(mafile_data, ensure_ascii=False, separators=(",", ":"))
        return line

    buf = io.BytesIO()
    all_data: list[str] = []
    global_txt_lines: list[str] = []
    folder_txt_map: dict[str, list[str]] = {}  # folder_name -> lines

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(mafiles_dir.glob("*.mafile")):
            try:
                raw = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue

            acct_name = raw.get("account_name", "")
            steam_id = str(raw.get("Session", {}).get("SteamID", ""))

            if account_logins:
                if acct_name not in account_logins and steam_id not in {str(a) for a in body.account_ids}:
                    continue

            filtered = _filter_mafile(raw, body.fields, body.session_fields)

            # Find matching account record for txt
            acc = account_map.get(acct_name, {})

            if body.format == "single_file":
                if acc:
                    all_data.append(_resolve_txt_line(body.txt_format, acc, filtered))
                else:
                    all_data.append(json.dumps(filtered, ensure_ascii=False, separators=(",", ":")))
            elif body.format == "per_account_folder":
                folder_name = _resolve_template(body.folder_name_template, acct_name, steam_id)
                mafile_name = _resolve_template(body.mafile_name_template, acct_name, steam_id)

                if body.skip_folders:
                    zf.writestr(mafile_name, json.dumps(filtered, ensure_ascii=False, separators=(",", ":")))
                else:
                    zf.writestr(f"{folder_name}/{mafile_name}", json.dumps(filtered, ensure_ascii=False, separators=(",", ":")))

                    if body.include_txt_per_folder and acc:
                        txt_name = _resolve_template(body.txt_name_template, acct_name, steam_id)
                        line = _resolve_txt_line(body.txt_format, acc, filtered)
                        if folder_name not in folder_txt_map:
                            folder_txt_map[folder_name] = []
                        folder_txt_map[folder_name].append(line)
                        zf.writestr(f"{folder_name}/{txt_name}", line + "\n")
            else:
                mafile_name = _resolve_template(body.mafile_name_template, acct_name, steam_id)
                zf.writestr(mafile_name, json.dumps(filtered, ensure_ascii=False, separators=(",", ":")))

            # Collect global txt line
            if body.include_global_txt and acc:
                global_txt_lines.append(_resolve_txt_line(body.txt_format, acc, filtered))

        if body.format == "single_file" and all_data:
            zf.writestr("accounts.txt", "\n".join(all_data) + "\n")

        if body.include_global_txt and global_txt_lines:
            zf.writestr("accounts.txt", "\n".join(global_txt_lines) + "\n")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=mafiles_export.zip"},
    )
