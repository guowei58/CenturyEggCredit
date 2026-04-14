# Credit memo default outline

The app looks for the shared outline in this order (first match wins):

1. **`CREDIT_MEMO_PUBLIC_TEMPLATE_PATH`** — absolute path to a `.docx` on the server
2. **`credit-memo-defaults/default-memo-outline.docx`** (recommended for git/deploy)
3. **`default-memo-outline.docx`** in the project root (next to `package.json`)
4. **`Credit Memo Outline.docx`** in the project root

That file is served to every user as the **shared default** memo template when no personal template is configured. It is not stored in individual user workspaces.

After adding or changing the file, redeploy or restart the app so the server picks up the new document.
