# Windows 10 WSL setup for protected B1 evidence capture

Status: **setup-only; this document does not authorize B1 or a production database write**

The guarded production runner supports macOS and Linux. On Windows 10, use an
Ubuntu WSL 2 distribution. Native Windows execution intentionally fails closed
because it cannot preserve the reviewed POSIX permissions and executable-path
rules.

## 1. Prepare the encrypted host and WSL 2

Before installing anything, confirm the Windows system volume that stores the
WSL distribution is protected by BitLocker and has at least 10 GiB free. Run
this in an elevated PowerShell window:

```powershell
manage-bde -status C:\
wsl --install -d Ubuntu
```

Restart if Windows requests it. Then confirm the Ubuntu distribution is version
2, not version 1:

```powershell
wsl --list --verbose
wsl --set-version Ubuntu 2
```

Keep the repository and all B1 artifacts inside the Linux filesystem, such as
`/home/<linux-user>/`, not under `/mnt/c`. This preserves the mode-`0700` and
mode-`0600` checks enforced by the runner.

## 2. Install the exact local tooling inside Ubuntu

Install the PostgreSQL project Apt repository before installing the versioned
client. Ubuntu may ship a different PostgreSQL version by default.

```sh
sudo apt update
sudo apt install -y postgresql-common ca-certificates git
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-client-17
```

Install Node 24.x through an approved Linux package source or version manager.
Do not use Node 20 or a Windows Node executable through `/mnt/c`. Install
Docker Desktop for Windows separately, enable its Ubuntu WSL integration, and
then verify all tools from the Ubuntu shell:

```sh
node --version
/usr/lib/postgresql/17/bin/pg_dump --version
/usr/lib/postgresql/17/bin/pg_restore --version
/usr/lib/postgresql/17/bin/psql --version
docker info
```

The expected PostgreSQL major version is 17. The local runner uses only
`/usr/lib/postgresql/17/bin` plus standard Linux system directories; it does
not inherit an arbitrary `PATH`.

## 3. Create the protected local workspace

Clone the repository into the Ubuntu home directory and install its locked
dependencies there:

```sh
git clone https://github.com/Yule-Love-Lights/yll-call-copilot.git ~/yll-call-copilot
cd ~/yll-call-copilot
npm ci
mkdir -m 700 ~/YLL-Protected-Backups
```

Place the independently reviewed Supabase CA PEM only in a new mode-`0700`
directory beneath `~/YLL-Protected-Backups`, with the PEM itself mode `0600`.
Verify its SHA-256 privately. Do not place it in the repository, OneDrive,
Dropbox, email, chat, or a shared folder.

Save the production database URL only in a local secret store that does not
write it to shell history, a repository file, or a WSL profile. Never paste it
into chat. The B1 operator will retrieve it privately immediately before the
guarded command.

## 4. Stop before production access

Before B1, provide only these non-secret confirmations:

- BitLocker is on for the volume containing the WSL distribution and at least
  10 GiB is free.
- `wsl --list --verbose` shows Ubuntu version 2.
- Node is 24.x; all three PostgreSQL clients are 17.x; Docker is running.
- the clone is at the separately authorized merged Hub SHA and `npm ci` passed.
- the CA file is protected and its reviewed SHA-256 matches.

The operator must then re-run the repository's guarded preflight. B1 still
requires its own exact-SHA authorization. It permits only the Hub Vercel
pause/resume, protected dump, and read-only export. It never permits a schema
change, migration-history repair, calls, sends, cron, Railway, recording
release, or Quote Tool change.
