import paramiko
import os
import stat

HOST = "156.67.72.214"
PORT = 65002
USER = "u966192992"
PASS = "Mi@mi2020!!"
DIST_DIR = os.path.join(os.path.dirname(__file__), "dist")
REMOTE_ROOT = "/home/u966192992/domains/ziarem.com/public_html"

def upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload a directory."""
    for item in os.listdir(local_dir):
        local_path = os.path.join(local_dir, item)
        remote_path = remote_dir + "/" + item
        if os.path.isdir(local_path):
            try:
                sftp.stat(remote_path)
            except FileNotFoundError:
                sftp.mkdir(remote_path)
            upload_dir(sftp, local_path, remote_path)
        else:
            size = os.path.getsize(local_path)
            print(f"  Uploading {item} ({size:,} bytes) -> {remote_path}")
            sftp.put(local_path, remote_path)

def main():
    print(f"Connecting to {HOST}:{PORT}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=15)
    print("Connected!")

    # Check remote dir
    stdin, stdout, stderr = ssh.exec_command(f"ls -la {REMOTE_ROOT}/")
    print(f"\nCurrent {REMOTE_ROOT}:")
    print(stdout.read().decode().strip())

    # Check nodejs dir
    stdin, stdout, stderr = ssh.exec_command("ls -la /home/u966192992/domains/ziarem.com/nodejs/ | head -20")
    print("\nnodejs dir:")
    print(stdout.read().decode().strip())

    stdin, stdout, stderr = ssh.exec_command("cat /home/u966192992/domains/ziarem.com/nodejs/package.json 2>/dev/null | head -20")
    pkg = stdout.read().decode().strip()
    if pkg:
        print("\nnodejs package.json:")
        print(pkg)

    # Upload dist files to public_html
    print(f"\nUploading {DIST_DIR} -> {REMOTE_ROOT}")
    sftp = ssh.open_sftp()
    upload_dir(sftp, DIST_DIR, REMOTE_ROOT)
    sftp.close()

    # Verify upload
    stdin, stdout, stderr = ssh.exec_command(f"ls -la {REMOTE_ROOT}/")
    print(f"\nAfter upload:")
    print(stdout.read().decode().strip())

    ssh.close()
    print("\nDone!")

if __name__ == "__main__":
    main()
