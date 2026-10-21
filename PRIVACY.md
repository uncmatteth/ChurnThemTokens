# ChurnThemTokens privacy

ChurnThemTokens connects one ChatGPT web conversation you choose to local tools
on your computer. The extension reads that chat's visible model selection and
the tool requests in its page. It sends requests to the local helper through
Chrome native messaging, then inserts the helper's results into that same
ChatGPT conversation. The results can contain file paths, file contents, command
output, and other project information. ChatGPT receives whatever the extension
inserts into your chat under your existing account.

The extension does not send this information to a ChurnThemTokens server. It
has no developer telemetry, advertising, sale of data, or model API calls. It
does not copy your ChatGPT password, cookies, or browser session files. The
extension uses the active tab only when you open it and choose to connect.

The local helper stores configuration, operation records, job output, backups,
and checkpoints in a private directory on your computer. Operation records
contain the operation, time, argument digest, and status; job output and backup
files may contain project data. The helper does not automatically purge this
local state. You control which project folders and tool permissions it gets.
Shell commands run as your OS user and can reach beyond the approved folders.

Disconnecting stops the helper's owned jobs and ends that chat's connection.
Deleting local state or ChatGPT conversation history is a separate action under
your control. ChatGPT handles the content sent to your account under its own
privacy terms. Any network access you explicitly request through local tools
is governed by the destination you choose.

The data described here is used only to provide the tool connection you ask
for. We do not use it for advertising, profiling, credit decisions, or sale to
data brokers. See [Security](SECURITY.md) for the tool access boundaries.
Our use of data obtained through Chrome permissions complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements. We use it
only for the extension's stated connection feature and do not let a developer
or employee read your local files or chat messages without your specific
request for support.
For questions or support, use the [project issue tracker](https://github.com/uncmatteth/ChurnThemTokens/issues).
