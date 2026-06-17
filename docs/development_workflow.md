# CI/CD Workflow: Pre-Commit, Commitizen & Auto-Bump

This document describes the automated code quality controls, commit message verification, and version bumping pipeline configured in the `alleinsein` repository.

---

## 1. Local Code Hygiene: Pre-Commit Hooks

We use `pre-commit` to run linting, formatting, type checking, and commit message analysis automatically before commits are finalized.

### Configuration (`.pre-commit-config.yaml`)

The project configures local hooks using your virtual environment via `uv run --active`:

- **`ruff-check`**: Lints and automatically fixes issues in Python files.
- **`ruff-format-check`**: Automatically formats Python files according to the project's formatting standard.
- **`ty-check`**: Runs static type-checking verification.
- **`prettier-check`**: Checks all frontend HTML, CSS, JavaScript, and JSON files inside `frontend/static/` to ensure code layout consistency.
- **`commitizen-check`**: Intercepts the commit message phase and blocks commits if the message does not adhere to the **Conventional Commits** specification.

### Setup and Installation

To enable pre-commit checks locally, run:

```bash
# Verify pre-commit is installed via dev dependencies
uv sync

# Install the hooks for both pre-commit and commit-msg stages
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg
```

To run all checks manually on the entire codebase:

```bash
uv run pre-commit run --all-files
```

---

## 2. Standardized Commit Messages: Commitizen

To automate versioning, the project requires all commit messages to follow the **Conventional Commits** standard.

### Syntax Structure

Commit messages must look like this:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

Where `<type>` is one of:

- `feat`: A new feature (triggers a **minor** version bump, e.g., `0.1.0` -> `0.2.0`).
- `fix`: A bug fix (triggers a **patch** version bump, e.g., `0.1.0` -> `0.1.1`).
- `docs`: Documentation updates.
- `style`: Formatting, missing semicolons, etc. (no production code changes).
- `refactor`: Refactoring production code (without changing behavior).
- `perf`: Performance improvements.
- `test`: Adding missing tests or refactoring tests.
- `chore`: Maintenance tasks, dependencies, build settings.

_Note: Adding a `!` after the type (e.g. `feat!:`) or adding `BREAKING CHANGE:` in the footer triggers a **major** version bump (e.g., `0.1.0` -> `1.0.0`)._

### Committing Locally

Instead of raw `git commit`, use Commitizen's interactive CLI:

```bash
uv run cz commit
```

This launches a CLI wizard that helps you categorize and format your changes correctly.

---

## 3. Automated Release: GitHub Version Bump Workflow

On a push or pull-request merge to the `main` branch, a GitHub Action automatically bumps the version number, creates a release tag, and updates files.

### Workflow Configuration (`.github/workflows/version-bump.yml`)

The action runs on Ubuntu runners and requires repository write permissions:

```yaml
name: Version bump

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  bump-version:
    if: ${{ !startsWith(github.event.head_commit.message, 'bump:') }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
        with:
          fetch-depth: 0 # Fetches full history so commitizen can analyze tags and commits

      - name: Bump version
        id: commitizen
        uses: commitizen-tools/commitizen-action@master
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          changelog: false
          no_raise: 21
          check_consistency: true

      - name: Print version
        run: echo "Bumped to ${{ steps.commitizen.outputs.version }}"
```

### How the Auto-Bump Logic Works

1. **Branch Push**: A developer merges a pull request or pushes code to `main`.
2. **Loop Check**: The workflow checks if the commit message starts with `bump:`. If it does, the workflow terminates immediately. This prevents infinite loops.
3. **Commit Analysis**: The Commitizen Action checks all commits since the last Git tag.
4. **Determine Bump**:
   - If there are `BREAKING CHANGE` commits, it schedules a **Major** bump.
   - If there are `feat` commits, it schedules a **Minor** bump.
   - If there are only `fix` commits, it schedules a **Patch** bump.
5. **Version Updates**: The Action writes the new version to:
   - `pyproject.toml` (`[project]` table `version = "X.Y.Z"` via the PEP 621 provider).
   - `backend/_version.py` (`__version__ = "X.Y.Z"`).
6. **Commit and Push**: The Action commits the changes with the message `bump: version X.Y.Z`, tags the commit as `vX.Y.Z`, and pushes both the commit and tag back to the `main` branch.
