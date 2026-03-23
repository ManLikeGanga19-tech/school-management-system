# ShuleHQ Database Backup

Automated `pg_dump` backups with local rotation and optional offsite upload to
Cloudflare R2 (free 10 GB, zero egress) or any S3-compatible storage.

## Files

| File          | Purpose                                              |
|---------------|------------------------------------------------------|
| `backup.sh`   | Creates a dump, rotates old files, uploads offsite   |
| `restore.sh`  | Restores a dump (local file or direct from R2/S3)    |

---

## Cloudflare R2 setup (free — recommended)

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Create a bucket named `sms-backups`
3. Go to **R2 → Manage R2 API tokens** → Create token
   - Permissions: **Object Read & Write** on bucket `sms-backups`
   - Copy the **Access Key ID** and **Secret Access Key**
4. Copy your **Account ID** from the R2 overview page

Your endpoint URL is: `https://e47b53757d342e1a931e12eed54620fd.r2.cloudflarestorage.com`

---

## Install on the production server

### 1. Install AWS CLI (used for S3-compatible uploads)

```bash
# Ubuntu / Debian
sudo apt-get install -y awscli

# Or via pip
pip install awscli
```

### 2. Copy the scripts

```bash
sudo mkdir -p /opt/sms/backup
sudo cp infra/backup/backup.sh  /opt/sms/backup/backup.sh
sudo cp infra/backup/restore.sh /opt/sms/backup/restore.sh
sudo chmod +x /opt/sms/backup/backup.sh /opt/sms/backup/restore.sh
```

### 3. Create the environment file

```bash
sudo tee /opt/sms/backup/.env <<'EOF'
# Database
POSTGRES_CONTAINER=sms-postgres
POSTGRES_DB=school_manager_db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-db-password-here

# Local backup storage
BACKUP_DIR=/var/backups/sms
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=3

# Cloudflare R2 (replace with your values)
BACKUP_S3_BUCKET=sms-backups
BACKUP_S3_ENDPOINT=https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_KEY_ID=<YOUR_R2_ACCESS_KEY_ID>
BACKUP_S3_SECRET=<YOUR_R2_SECRET_ACCESS_KEY>

# Failure alerts via ntfy.sh (free, no account needed)
# Pick any unique topic name — keep it secret (it's your alert channel)
BACKUP_NTFY_TOPIC=shulehq-backup-abc123
EOF

sudo chmod 600 /opt/sms/backup/.env
```

### 4. Test the backup manually

```bash
sudo bash -c 'source /opt/sms/backup/.env && /opt/sms/backup/backup.sh'
```

Check that:

- A `.sql.gz` file appears in `/var/backups/sms/`
- The file appears in your R2 bucket (if configured)

### 5. Schedule with cron

```bash
sudo crontab -e
```

Add this line — runs at **02:00 UTC** daily:

```cron
0 2 * * * bash -c 'source /opt/sms/backup/.env && /opt/sms/backup/backup.sh' >> /var/log/sms-backup.log 2>&1
```

---

## Failure alerts (ntfy.sh)

Set `BACKUP_NTFY_TOPIC=your-unique-topic` in `.env`.
Subscribe on your phone: download the **ntfy** app → subscribe to `your-unique-topic`.
You'll get a push notification if a backup fails. Free, no account needed.

---

## Restoring from a backup

**Always test restores on staging first.**

```bash
# List available local backups
ls -lh /var/backups/sms/

# Restore from local file
source /opt/sms/backup/.env
/opt/sms/backup/restore.sh /var/backups/sms/daily_20260320_020000.sql.gz

# Restore directly from R2
source /opt/sms/backup/.env
/opt/sms/backup/restore.sh s3://sms-backups/daily_20260320_020000.sql.gz
```

The restore script will prompt for confirmation before dropping the database.

---

## Retention policy

| Tier    | Kept for  | Triggered on                                    |
|---------|-----------|-------------------------------------------------|
| Daily   | 7 days    | Every day except Sunday and 1st of month        |
| Weekly  | 4 weeks   | Every Sunday                                    |
| Monthly | 3 months  | 1st of every month                              |

Monthly takes priority → if the 1st falls on a Sunday, it's a monthly backup.

---

## Monitoring backup file sizes

A sudden drop in backup size can indicate data loss. Check periodically:

```bash
ls -lh /var/backups/sms/ | sort
```

Or check R2 usage in the Cloudflare dashboard.
