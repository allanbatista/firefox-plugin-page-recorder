# Shell commands use rtk

Always prefix shell commands with `rtk`.

# Follow feature workflow

Before implementation code, read the project AGENTS guidance and follow the feature workflow (spec -> plan -> progress). Use the feature-workflow guidance when editing workflow docs.

# Protect concurrent work

Do not revert user changes, avoid destructive git commands unless explicitly requested, and use `apply_patch` for manual file edits.

