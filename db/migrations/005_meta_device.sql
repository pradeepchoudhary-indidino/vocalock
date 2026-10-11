-- Device details for Conversions API events: Meta rejects an app event whose
-- extinfo lacks the Android version. Sent by the app with its Meta ids.

ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_os_version   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_device_model TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS meta_app_version  TEXT;
