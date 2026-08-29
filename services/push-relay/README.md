# Pichamber push relay

Central APNs sender for packaged Desktop. Clients sign with their auto-generated
keypair; this host holds the project `.p8` and talks to Apple.

Public URL: `https://pichamber.bmlab.top/v1/push/send`  
Register: `https://pichamber.bmlab.top/v1/push/register-token`

The `.p8` lives on `bmlab` at `/opt/pichamber-push/secrets/` — never commit it.
