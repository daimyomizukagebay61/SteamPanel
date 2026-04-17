import base64

import rsa


def get_rsa_key(response_data: dict) -> tuple[str, str, int]:
    """Extract RSA key components from Steam's getrsakey response."""
    mod = response_data["publickey_mod"]
    exp = response_data["publickey_exp"]
    timestamp = int(response_data["timestamp"])
    return mod, exp, timestamp


def encrypt_password(password: str, mod_hex: str, exp_hex: str) -> str:
    """RSA-encrypt a password using Steam's public key, return base64."""
    mod = int(mod_hex, 16)
    exp = int(exp_hex, 16)
    public_key = rsa.PublicKey(mod, exp)
    encrypted = rsa.encrypt(password.encode("ascii"), public_key)
    return base64.b64encode(encrypted).decode("ascii")
