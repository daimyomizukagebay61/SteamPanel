class SteamPanelError(Exception):
    def __init__(self, message: str, code: str = "unknown_error") -> None:
        self.message = message
        self.code = code
        super().__init__(message)


class SteamAuthError(SteamPanelError):
    def __init__(self, message: str = "Authentication failed") -> None:
        super().__init__(message, code="auth_error")


class SteamGuardError(SteamPanelError):
    def __init__(self, message: str = "Steam Guard operation failed") -> None:
        super().__init__(message, code="guard_error")


class ProxyError(SteamPanelError):
    def __init__(self, message: str = "Proxy error") -> None:
        super().__init__(message, code="proxy_error")


class MafileError(SteamPanelError):
    def __init__(self, message: str = "Invalid mafile") -> None:
        super().__init__(message, code="mafile_error")


class TaskError(SteamPanelError):
    def __init__(self, message: str = "Task execution failed") -> None:
        super().__init__(message, code="task_error")


class EmailError(SteamPanelError):
    def __init__(self, message: str = "Email operation failed") -> None:
        super().__init__(message, code="email_error")
