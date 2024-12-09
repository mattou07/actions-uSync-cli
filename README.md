# uSync CLI Action

Use this Action to invoke the Usync CLI in your workflows: https://github.com/Jumoo/uSync.CommandLine

## What does this action do?
This action will install the Usync CLI via dotnet tool install: `dotnet tool install uSync.Cli -g` onto you GitHub agent
Then invoke any command implemented/supported in the Usync CLI.

This action is a wrapper around the uSync CLI tool, should you need support for additional commands, please send a pull request to https://github.com/Jumoo/uSync.CommandLine

**DISCLAIMER: This action is still under development, use with caution.**

# How to use?

Ensure you have setup Usync Commands on your Umbraco website, you can follow steps to do this on Kevin's readme here: https://github.com/Jumoo/uSync.CommandLine?tab=readme-ov-file#usync-command-library-for-umbraco

Additional info here also: https://github.com/Jumoo/uSync.CommandLine/blob/v11/main/uSync.Commands.Server/readme.md

**Tagged versions currently not supported yet as this is an early version, for now @main is used to grab the latest changes of the action from the main branch**

In your workflow add the following YAML to install this action.

```yaml
      - name: Test Setup Action
        id: setup-action
        uses: mattou07/actions-uSync-cli/setup@main
```

Then after the install step use the invoke action to invoke any command supported by the CLI. Ensure you have added your generated HMAC key as a secret to keep it safe.
Change the `command: 'ping'` line to whatever command you wish.
```yaml
      - name: USync CLI ping
        id: invoke-action-ping
        uses: mattou07/actions-uSync-cli/invoke@main
        with:
          command: 'ping'
          server: ${{ vars.UMBRACO_WEBAPP_URL}}
          key: ${{ secrets.HMAC }}
```

# Wishful TODO's
- See if we can support forked versions of https://github.com/Jumoo/uSync.CommandLine to be installed.
- Parse output from the CLI to assert outcomes, such as Report returning true if changes are detected or if an import failed
