from app.core.task_manager import task_manager
from app.services.steam_guard import remove_guard, generate_2fa
from app.services.steam_password import change_password, random_password
from app.services.steam_email import change_email, validate_account
from app.services.steam_phone import change_phone
from app.services.steam_checker import check_logpass_account, full_parse_logpass_account
from app.services.steam_token_checker import check_token_account


def register_all_handlers() -> None:
    task_manager.register_handler("change_password", change_password)
    task_manager.register_handler("random_password", random_password)
    task_manager.register_handler("change_email", change_email)
    task_manager.register_handler("change_phone", change_phone)
    task_manager.register_handler("remove_guard", remove_guard)
    task_manager.register_handler("generate_2fa", generate_2fa)
    task_manager.register_handler("validate", validate_account)
    task_manager.register_handler("logpass_validate", check_logpass_account)
    task_manager.register_handler("logpass_full_parse", full_parse_logpass_account)
    task_manager.register_handler("token_validate", check_token_account)
