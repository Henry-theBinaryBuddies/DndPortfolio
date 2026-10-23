#!/usr/bin/env bash
# Sets up SSH key login for the user who runs it, and (as a separate, deliberate step) turns password logins off.
#
#   bash setup-ssh.sh [PUBLIC_KEY_FILE]      step 1: allow your key (default file: ~/id_ed25519.pub). No sudo needed.
#   sudo bash setup-ssh.sh --lock            step 2: refuse passwords. Only after step 1 and a successful key login!
#   sudo bash setup-ssh.sh --unlock          the way back: allow passwords again.
#
# Step 2 refuses to run unless the user who typed sudo already has a usable key, so it cannot lock you out of your own account.

set -euo pipefail

DROP_IN=/etc/ssh/sshd_config.d/00-hardening.conf
me="${USER:-$(id -un)}"

has_key() {  # does this authorized_keys file hold at least one key ssh-keygen can read?
    [ -s "$1" ] && ssh-keygen -lf "$1" >/dev/null 2>&1
}

case "${1:-}" in
--lock)
    [ "$(id -u)" -eq 0 ] || { echo "Run this with sudo: sudo bash $0 --lock"; exit 1; }
    user="${SUDO_USER:-}"
    [ -n "$user" ] || { echo "Run it through sudo from your own account, not as root directly."; exit 1; }
    home="$(getent passwd "$user" | cut -d: -f6)"
    if ! has_key "$home/.ssh/authorized_keys"; then
        echo "Refusing: $user has no usable key in $home/.ssh/authorized_keys, so turning passwords off would lock you out."
        echo "Run step 1 first and check that 'ssh $user@<this server>' logs in without a password."
        exit 1
    fi
    cat >"$DROP_IN" <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
    if ! sshd -t; then
        rm -f "$DROP_IN"
        echo "The SSH settings did not check out, so they were removed and nothing changed."
        exit 1
    fi
    systemctl restart ssh
    echo "Passwords are now refused. Keep this window open and, in a NEW window, check that:"
    echo "  ssh $user@<this server>                                   logs you in with your key"
    echo "  ssh -o PubkeyAuthentication=no $user@<this server>        says: Permission denied (publickey)"
    echo "If the first one fails, run: sudo bash $0 --unlock"
    ;;
--unlock)
    [ "$(id -u)" -eq 0 ] || { echo "Run this with sudo: sudo bash $0 --unlock"; exit 1; }
    rm -f "$DROP_IN"
    sshd -t && systemctl restart ssh
    echo "Password logins are allowed again."
    ;;
*)
    key_file="${1:-$HOME/id_ed25519.pub}"
    [ -r "$key_file" ] || { echo "Cannot read $key_file. Copy your public key to this server first (see docs/DEPLOYMENT.md)."; exit 1; }
    key="$(tr -d '\r' <"$key_file" | head -n 1)"
    case "$key" in
    ssh-ed25519\ * | ssh-rsa\ * | ecdsa-sha2-*) ;;
    *)
        echo "$key_file does not look like a public key (it should start with ssh-ed25519)."
        exit 1
        ;;
    esac
    mkdir -p "$HOME/.ssh"
    chmod 700 "$HOME/.ssh"
    touch "$HOME/.ssh/authorized_keys"
    sed -i 's/\r$//' "$HOME/.ssh/authorized_keys"  # a Windows line ending would make the key unreadable
    grep -qxF "$key" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$key" >>"$HOME/.ssh/authorized_keys"
    chmod 600 "$HOME/.ssh/authorized_keys"
    chmod go-w "$HOME"  # SSH ignores keys if the home folder can be written by others
    rmdir "$HOME/700" "$HOME/chmod" 2>/dev/null || true  # empty folders left by an earlier typo
    echo "Keys now allowed for $me:"
    ssh-keygen -lf "$HOME/.ssh/authorized_keys"
    echo
    echo "Next, on your laptop, in a NEW window:  ssh $me@<this server>"
    echo "It should log you in without asking for this account's password. When it does, run:  sudo bash $0 --lock"
    ;;
esac
