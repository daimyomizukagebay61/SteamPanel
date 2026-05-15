import sys
import os
import subprocess
import urllib.request
import urllib.error
import zipfile
import shutil
import hashlib
import json
import tempfile
from pathlib import Path
from datetime import datetime

GITHUB_REPO = "daimyomizukagebay61/SteamPanel"
BRANCH = "main"
ROOT = Path(__file__).parent

# dirs to never touch when copying from ZIP
PROTECTED = {"data", "data_backup", "venv", ".git", "__pycache__"}


# ── helpers ──────────────────────────────────────────────────────────────────

def get_version():
    ver_file = ROOT / "version.py"
    if not ver_file.exists():
        return "unknown"
    try:
        ns = {}
        exec(ver_file.read_text(encoding="utf-8"), ns)
        return ns.get("VERSION", "unknown")
    except Exception:
        return "unknown"


def file_hash(path):
    try:
        return hashlib.md5(Path(path).read_bytes()).hexdigest()
    except Exception:
        return None


def git(*args, capture=False):
    kwargs = {"cwd": str(ROOT)}
    if capture:
        kwargs["capture_output"] = True
        kwargs["text"] = True
    return subprocess.run(["git", "--no-pager"] + list(args), **kwargs)


def reinstall_requirements():
    print("Installing dependencies...")
    venv_pip = ROOT / "venv" / "Scripts" / "pip.exe"
    if venv_pip.exists():
        cmd = [str(venv_pip), "install", "-r", str(ROOT / "requirements.txt"), "-q"]
    else:
        cmd = [sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt"), "-q"]
    subprocess.run(cmd)
    hash_file = ROOT / "data" / ".req_hash"
    hash_file.parent.mkdir(exist_ok=True)
    hash_file.write_text(file_hash(ROOT / "requirements.txt") or "")


def rebuild_frontend():
    frontend = ROOT / "frontend"
    if not frontend.exists():
        return
    if subprocess.run(["npm", "--version"], capture_output=True).returncode != 0:
        print("[!] Node.js not found — skipping frontend rebuild.")
        print("    If UI looks broken: cd frontend && npm install && npm run build")
        return
    print("Rebuilding frontend...")
    subprocess.run(["npm", "install", "--silent"], cwd=str(frontend))
    subprocess.run(["npm", "run", "build"], cwd=str(frontend))
    print("Frontend rebuilt.")


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "SteamPanel-Updater"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done * 100 // total:3d}%  {done / 1048576:.1f} MB", end="", flush=True)
                else:
                    print(f"\r  {done / 1048576:.1f} MB", end="", flush=True)
    print()


# ── git update path ───────────────────────────────────────────────────────────

def update_via_git():
    if subprocess.run(["git", "--version"], capture_output=True).returncode != 0:
        print("[!] git not found. Install Git from https://git-scm.com")
        return

    print("Checking for updates...")
    if git("fetch", "origin", BRANCH).returncode != 0:
        print("[!] Failed to reach GitHub. Check your internet connection.")
        return

    local  = git("rev-parse", "HEAD",              capture=True).stdout.strip()
    remote = git("rev-parse", f"origin/{BRANCH}",  capture=True).stdout.strip()

    if local == remote:
        print("\n[+] Already up to date.")
        return

    print("\nNew commits:")
    print("-" * 40)
    git("log", f"HEAD..origin/{BRANCH}", "--oneline")
    print("-" * 40)

    if input("\nUpdate now? [Y/N]: ").strip().upper() != "Y":
        print("Cancelled.")
        return

    # stash local changes so pull is clean
    stash = git("stash", capture=True)
    had_stash = "No local changes" not in (stash.stdout or "")
    if had_stash:
        print("Local changes stashed.")

    # backup branch as a safety net
    backup = f"backup_{datetime.now().strftime('%Y-%m-%d_%H-%M-%S')}"
    git("branch", backup)
    print(f"Backup branch: {backup}")

    req_hash_before      = file_hash(ROOT / "requirements.txt")
    frontend_hash_before = file_hash(ROOT / "frontend" / "package.json")

    print("Pulling updates...")
    if git("pull", "origin", BRANCH).returncode != 0:
        print("\n[!] Pull failed. Restoring backup branch...")
        git("reset", "--hard", backup)
        if had_stash:
            git("stash", "pop")
        return

    if had_stash:
        result = git("stash", "pop")
        if result.returncode != 0:
            print("[!] Could not restore stashed changes automatically.")
            print(f"    Run: git stash pop   (or check: git stash list)")

    new_ver = get_version()
    print(f"\nUpdated: {local[:7]} -> {new_ver}")

    if file_hash(ROOT / "requirements.txt") != req_hash_before:
        reinstall_requirements()

    if file_hash(ROOT / "frontend" / "package.json") != frontend_hash_before:
        rebuild_frontend()

    print(f"\n[+] Update complete! Run run.bat to start.")


# ── ZIP download path ─────────────────────────────────────────────────────────

def update_via_zip():
    print("No .git folder — using GitHub release download.\n")

    # fetch latest release info
    api = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
    zip_url = tag_name = None
    try:
        req = urllib.request.Request(api, headers={"User-Agent": "SteamPanel-Updater"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        zip_url  = data.get("zipball_url")
        tag_name = data.get("tag_name", "latest")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"[!] GitHub API error: {e}")
            return
    except Exception as e:
        print(f"[!] Failed to reach GitHub: {e}")
        return

    if not zip_url:
        # no releases yet — grab main branch zipball
        zip_url  = f"https://api.github.com/repos/{GITHUB_REPO}/zipball/{BRANCH}"
        tag_name = BRANCH

    current_ver = get_version()
    print(f"Installed : {current_ver}")
    print(f"Available : {tag_name}")

    if input("\nDownload and install? [Y/N]: ").strip().upper() != "Y":
        print("Cancelled.")
        return

    # backup data/ before touching anything
    data_dir    = ROOT / "data"
    data_backup = ROOT / "data_backup"
    if data_dir.exists():
        print("Backing up data/...")
        if data_backup.exists():
            shutil.rmtree(data_backup)
        shutil.copytree(data_dir, data_backup)
        print("Backed up to data_backup/")

    with tempfile.TemporaryDirectory() as tmp:
        zip_path = os.path.join(tmp, "update.zip")

        print("Downloading...")
        try:
            download(zip_url, zip_path)
        except Exception as e:
            print(f"[!] Download failed: {e}")
            return

        req_hash_before      = file_hash(ROOT / "requirements.txt")
        frontend_hash_before = file_hash(ROOT / "frontend" / "package.json")

        print("Extracting...")
        extract_dir = os.path.join(tmp, "src")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(extract_dir)

        # GitHub always wraps in one top-level folder (reponame-sha/)
        entries = os.listdir(extract_dir)
        source = Path(extract_dir) / entries[0] if len(entries) == 1 else Path(extract_dir)

        print("Installing...")
        for item in source.iterdir():
            if item.name in PROTECTED:
                continue
            dest = ROOT / item.name
            if item.is_dir():
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.copytree(item, dest)
            else:
                shutil.copy2(item, dest)

        # safety net: restore data if something went wrong
        if not data_dir.exists() and data_backup.exists():
            print("Restoring data/ from backup...")
            shutil.copytree(data_backup, data_dir)

        if file_hash(ROOT / "requirements.txt") != req_hash_before:
            reinstall_requirements()
        elif not (ROOT / "data" / ".req_hash").exists():
            reinstall_requirements()

        if file_hash(ROOT / "frontend" / "package.json") != frontend_hash_before:
            rebuild_frontend()

    new_ver = get_version()
    if new_ver != current_ver:
        print(f"\nUpdated: {current_ver} -> {new_ver}")

    print("\n[+] Update complete! Run run.bat to start.")


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    print()
    print("  SteamPanel Updater")
    print("  ==================")
    print(f"\n  Current version: {get_version()}\n")

    if (ROOT / ".git").exists():
        update_via_git()
    else:
        update_via_zip()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nCancelled.")
