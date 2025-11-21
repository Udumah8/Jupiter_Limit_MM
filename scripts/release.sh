#!/bin/bash

# Solana Market Maker Bot Release Script
# Handles version bumping, changelog updates, and git tagging

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VERSION_FILE="$PROJECT_ROOT/VERSION"
CHANGELOG_FILE="$PROJECT_ROOT/CHANGELOG.md"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat << EOF
Solana Market Maker Bot Release Script

USAGE:
    $0 [OPTIONS] <version> [release-notes]

ARGUMENTS:
    version        New version number (e.g., 1.0.1, 1.1.0, 2.0.0)
    release-notes  Optional release notes (if not provided, will be generated)

OPTIONS:
    -d, --dry-run  Show what would be done without making changes
    -f, --force    Skip confirmation prompts
    -h, --help     Show this help message
    --patch        Auto-increment patch version (1.0.0 -> 1.0.1)
    --minor        Auto-increment minor version (1.0.0 -> 1.1.0)
    --major        Auto-increment major version (1.0.0 -> 2.0.0)

EXAMPLES:
    $0 1.0.1 "Fixed critical bug in order placement"
    $0 --patch "Hotfix for wallet balance calculation"
    $0 --minor "Added new DEX support"
    $0 2.0.0 "Breaking changes in API"

VERSION FORMAT:
    MAJOR.MINOR.PATCH (Semantic Versioning)
    - MAJOR: Breaking changes
    - MINOR: New features (backward compatible)
    - PATCH: Bug fixes (backward compatible)

EOF
}

get_current_version() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE" | tr -d '\n'
    else
        echo "0.0.0"
    fi
}

validate_version() {
    local version="$1"
    if [[ ! $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log_error "Invalid version format: $version"
        log_info "Expected format: MAJOR.MINOR.PATCH (e.g., 1.0.1)"
        exit 1
    fi
}

increment_version() {
    local current="$1"
    local type="$2"

    IFS='.' read -ra VERSION_PARTS <<< "$current"
    local major="${VERSION_PARTS[0]}"
    local minor="${VERSION_PARTS[1]}"
    local patch="${VERSION_PARTS[2]}"

    case $type in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            log_error "Invalid increment type: $type"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

update_version_file() {
    local new_version="$1"
    echo "$new_version" > "$VERSION_FILE"
    log_info "Updated VERSION file to: $new_version"
}

update_changelog() {
    local new_version="$1"
    local release_notes="$2"
    local current_date=$(date +%Y-%m-%d)

    # Create new changelog entry
    local changelog_entry="## [$new_version] - $current_date

### $release_notes

"

    # Insert after the header but before the first existing version
    local temp_file=$(mktemp)
    awk -v entry="$changelog_entry" '
        /^## \[/ && !found { print entry; found=1 }
        { print }
    ' "$CHANGELOG_FILE" > "$temp_file"

    mv "$temp_file" "$CHANGELOG_FILE"
    log_info "Updated CHANGELOG.md with new version: $new_version"
}

update_package_json() {
    local new_version="$1"
    if [ -f "$PROJECT_ROOT/package.json" ]; then
        # Update version in package.json
        sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$PROJECT_ROOT/package.json"
        rm -f "$PROJECT_ROOT/package.json.bak"
        log_info "Updated package.json version to: $new_version"
    fi
}

create_git_commit() {
    local new_version="$1"
    local commit_message="Release version $new_version"

    git add "$VERSION_FILE" "$CHANGELOG_FILE"
    [ -f "$PROJECT_ROOT/package.json" ] && git add "$PROJECT_ROOT/package.json"

    git commit -m "$commit_message"
    log_info "Created git commit: $commit_message"
}

create_git_tag() {
    local new_version="$1"
    local tag_name="v$new_version"
    local tag_message="Release version $new_version"

    git tag -a "$tag_name" -m "$tag_message"
    log_info "Created git tag: $tag_name"
}

push_changes() {
    local new_version="$1"
    local tag_name="v$new_version"

    log_info "Pushing changes to remote repository..."
    git push origin main
    git push origin "$tag_name"

    log_success "Successfully pushed version $new_version to remote repository"
}

run_pre_release_checks() {
    log_info "Running pre-release checks..."

    # Check if working directory is clean
    if [ -n "$(git status --porcelain)" ]; then
        log_warning "Working directory is not clean. Uncommitted changes found:"
        git status --short
        if [ "$FORCE" != true ]; then
            read -p "Continue anyway? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Release cancelled."
                exit 0
            fi
        fi
    fi

    # Check if on main branch
    local current_branch=$(git branch --show-current)
    if [ "$current_branch" != "main" ]; then
        log_warning "Not on main branch (current: $current_branch)"
        if [ "$FORCE" != true ]; then
            read -p "Continue anyway? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log_info "Release cancelled."
                exit 0
            fi
        fi
    fi

    # Run tests if available
    if [ -f "$PROJECT_ROOT/package.json" ] && grep -q '"test"' "$PROJECT_ROOT/package.json"; then
        log_info "Running tests..."
        cd "$PROJECT_ROOT"
        npm test
        log_success "Tests passed"
    fi

    log_success "Pre-release checks completed"
}

generate_release_notes() {
    local new_version="$1"
    local current_version="$2"

    # Generate basic release notes based on version change
    local major=$(echo "$new_version" | cut -d. -f1)
    local minor=$(echo "$new_version" | cut -d. -f2)
    local patch=$(echo "$new_version" | cut -d. -f3)

    local current_major=$(echo "$current_version" | cut -d. -f1)
    local current_minor=$(echo "$current_version" | cut -d. -f2)

    if [ "$major" -gt "$current_major" ]; then
        echo "Major release with breaking changes"
    elif [ "$minor" -gt "$current_minor" ]; then
        echo "Minor release with new features"
    else
        echo "Patch release with bug fixes"
    fi
}

# Parse command line arguments
DRY_RUN=false
FORCE=false
AUTO_INCREMENT=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dry-run)
            DRY_RUN=true
            shift
            ;;
        -f|--force)
            FORCE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        --patch|--minor|--major)
            AUTO_INCREMENT="${1#--}"
            shift
            ;;
        -*)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
        *)
            if [ -z "$NEW_VERSION" ]; then
                NEW_VERSION="$1"
            elif [ -z "$RELEASE_NOTES" ]; then
                RELEASE_NOTES="$1"
            else
                log_error "Too many arguments"
                show_help
                exit 1
            fi
            shift
            ;;
    esac
done

# Validate arguments
if [ -n "$AUTO_INCREMENT" ] && [ -n "$NEW_VERSION" ]; then
    log_error "Cannot specify both auto-increment and explicit version"
    exit 1
fi

if [ -z "$AUTO_INCREMENT" ] && [ -z "$NEW_VERSION" ]; then
    log_error "Must specify either a version number or auto-increment option"
    show_help
    exit 1
fi

# Get current version
CURRENT_VERSION=$(get_current_version)
log_info "Current version: $CURRENT_VERSION"

# Determine new version
if [ -n "$AUTO_INCREMENT" ]; then
    NEW_VERSION=$(increment_version "$CURRENT_VERSION" "$AUTO_INCREMENT")
    log_info "Auto-incremented version: $CURRENT_VERSION -> $NEW_VERSION"
elif [ -n "$NEW_VERSION" ]; then
    validate_version "$NEW_VERSION"
    log_info "New version: $NEW_VERSION"
fi

# Generate release notes if not provided
if [ -z "$RELEASE_NOTES" ]; then
    RELEASE_NOTES=$(generate_release_notes "$NEW_VERSION" "$CURRENT_VERSION")
    log_info "Generated release notes: $RELEASE_NOTES"
fi

# Show what will be done
echo
log_info "Release Summary:"
echo "  Current Version: $CURRENT_VERSION"
echo "  New Version:     $NEW_VERSION"
echo "  Release Notes:   $RELEASE_NOTES"
if [ "$DRY_RUN" = true ]; then
    echo "  Mode:            DRY RUN (no changes will be made)"
else
    echo "  Mode:            LIVE RELEASE"
fi
echo

# Confirm release
if [ "$DRY_RUN" = false ] && [ "$FORCE" = false ]; then
    read -p "Proceed with release? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Release cancelled."
        exit 0
    fi
fi

# Run pre-release checks
if [ "$DRY_RUN" = false ]; then
    run_pre_release_checks
fi

# Execute release steps
log_info "Starting release process..."

if [ "$DRY_RUN" = true ]; then
    log_info "[DRY RUN] Would update VERSION file to: $NEW_VERSION"
    log_info "[DRY RUN] Would update CHANGELOG.md with: $RELEASE_NOTES"
    log_info "[DRY RUN] Would update package.json version"
    log_info "[DRY RUN] Would create git commit and tag: v$NEW_VERSION"
    log_info "[DRY RUN] Would push changes to remote repository"
else
    update_version_file "$NEW_VERSION"
    update_changelog "$NEW_VERSION" "$RELEASE_NOTES"
    update_package_json "$NEW_VERSION"
    create_git_commit "$NEW_VERSION"
    create_git_tag "$NEW_VERSION"
    push_changes "$NEW_VERSION"
fi

log_success "Release $NEW_VERSION completed successfully!"

if [ "$DRY_RUN" = false ]; then
    echo
    log_info "Next steps:"
    echo "  1. Create GitHub release with the changelog"
    echo "  2. Update Docker image tags if applicable"
    echo "  3. Notify stakeholders about the new release"
    echo "  4. Monitor for any issues post-release"
fi
