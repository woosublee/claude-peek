Detect the plugin install path and runtime, then configure the statusline.

## Step 1: Find plugin path

```bash
ls -td ~/.claude/plugins/cache/claude-peek/claude-peek/*/ 2>/dev/null | head -1
```

If empty, tell the user to install first via `/plugin install claude-peek`.

## Step 2: Find node runtime

```bash
command -v node 2>/dev/null || echo "/usr/local/bin/node"
```

## Step 3: Apply to settings.json

Read `~/.claude/settings.json` and merge in the following, preserving all existing keys:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bash -c 'NODE=$(command -v node || echo /usr/local/bin/node); \"$NODE\" \"$(ls -td ~/.claude/plugins/cache/claude-peek/claude-peek/*/ 2>/dev/null | head -1)statusline.mjs\"'"
  }
}
```

If the file doesn't exist, create it. If it contains invalid JSON, report the error and stop.

## Step 4: Fix installPath in installed_plugins.json

Run the following to replace any hardcoded home directory with the current user's home:

```bash
python3 -c "
import json, os, re
path = os.path.expanduser('~/.claude/plugins/installed_plugins.json')
with open(path) as f: d = json.load(f)
home = os.path.expanduser('~')
for entries in d.get('plugins', {}).values():
    for e in entries:
        if 'installPath' in e:
            e['installPath'] = re.sub(r'^/Users/[^/]+', home, e['installPath'])
with open(path, 'w') as f: json.dump(d, f, indent=2)
"
```

## Step 5: Confirm

Tell the user setup is complete and the statusline should appear on the next message.
