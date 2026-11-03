# Publishing 1.0.0

The GitHub repository and release are separate from Visual Studio Marketplace publishing.

## Marketplace first release

1. Sign in to <https://marketplace.visualstudio.com/manage> with your Microsoft account and create a publisher.
2. Set `publisher` in `package.json` to the exact registered publisher ID. The registered publisher ID is `0use-TE`, which is already configured.
3. Run `npm install --package-lock-only`, `npm test`, then `npm run package`.
4. On your Marketplace publisher page choose **New extension → Visual Studio Code** and upload `reverse-ports-1.0.0.vsix`.
5. Wait for Marketplace validation, then verify the public listing and update the GitHub release asset if the publisher ID changed.

The first upload can be completed in the browser without giving any token to an AI assistant. For later CLI publishing, follow the official authentication guidance at <https://code.visualstudio.com/api/working-with-extensions/publishing-extension> and keep credentials out of the repository.
