# BigaCli

Use minimal-engineering. Keep changes focused on the real user path.
`cloudcli/` contains the pinned upstream source. `custom/server/` contains the maintained JavaScript source for our customized modules; builds copy these modules after compiling upstream. `ui/` contains our page source. No minified string patching.
Build and publish from this repository. Never patch a user's installed program to deliver feature changes.
Never commit or package credentials, local databases, account stores, or conversation history.
Never modify or stop the original CloudCLI on port 3001.
0.1.0 is the public bootstrap release. The next release must remain a draft for the owner to publish.
