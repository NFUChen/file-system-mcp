#!/bin/sh
set -e

# Default plocate database location
PLOCATE_DB="${PLOCATE_DB:-/var/lib/plocate/plocate.db}"
PLOCATE_DB_DIR=$(dirname "$PLOCATE_DB")

# Ensure the database directory exists
mkdir -p "$PLOCATE_DB_DIR"

# Get allowed directories from command line arguments
# The arguments are passed directly to this script and will be forwarded to Node.js
# We'll use all arguments as potential directory paths for indexing
ALLOWED_DIRS=""

# Collect non-empty arguments
for arg in "$@"; do
  if [ -n "$arg" ]; then
    if [ -z "$ALLOWED_DIRS" ]; then
      ALLOWED_DIRS="$arg"
    else
      ALLOWED_DIRS="$ALLOWED_DIRS $arg"
    fi
  fi
done

# If no directories provided, check environment variable
if [ -z "$ALLOWED_DIRS" ] && [ -n "$ALLOWED_DIRECTORIES" ]; then
  ALLOWED_DIRS="$ALLOWED_DIRECTORIES"
fi

# Index the allowed directories if any are provided
if [ -n "$ALLOWED_DIRS" ]; then
  echo "Indexing allowed directories with plocate..." >&2
  
  # Collect valid directories
  VALID_DIRS=""
  for dir in $ALLOWED_DIRS; do
    # Expand ~ if present
    expanded_dir=$(echo "$dir" | sed "s|^~|$HOME|")
    
    if [ -d "$expanded_dir" ]; then
      echo "  Adding directory to index: $expanded_dir" >&2
      if [ -z "$VALID_DIRS" ]; then
        VALID_DIRS="$expanded_dir"
      else
        VALID_DIRS="$VALID_DIRS $expanded_dir"
      fi
    else
      echo "  Warning: Directory does not exist: $expanded_dir" >&2
    fi
  done
  
  # Use updatedb to create the database for the specified directories
  if [ -n "$VALID_DIRS" ]; then
    # Determine the best database root directory
    DATABASE_ROOT="/"

    # Count directories
    set -- $VALID_DIRS
    dir_count=$#

    if [ "$dir_count" -eq 1 ]; then
      # Single directory: use it as the database root
      DATABASE_ROOT="$1"
      echo "  Using single directory as database root: $DATABASE_ROOT" >&2
    else
      # Multiple directories: check if they share a common parent
      first_dir="$1"
      case "$first_dir" in
        /home/*|/Users/*)
          # Check if all directories are under the same user home
          user_home=$(echo "$first_dir" | cut -d'/' -f1-3)
          all_under_home=true
          for dir in $VALID_DIRS; do
            case "$dir" in
              "$user_home"/*) ;;
              *) all_under_home=false; break ;;
            esac
          done
          if [ "$all_under_home" = "true" ]; then
            DATABASE_ROOT="$user_home"
            echo "  Using user home as database root: $DATABASE_ROOT" >&2
          else
            echo "  Multiple unrelated directories, using root filesystem" >&2
          fi
          ;;
        *)
          echo "  Multiple directories found, using root filesystem for broad coverage" >&2
          ;;
      esac
    fi

    # Create the database with the determined root
    echo "  Creating plocate database with root: $DATABASE_ROOT" >&2
    updatedb --output "$PLOCATE_DB" --database-root "$DATABASE_ROOT" 2>&1 || {
      echo "Warning: plocate database update failed, continuing anyway..." >&2
      echo "This may be due to permissions or plocate configuration." >&2
      echo "The server will continue but search_files may fall back to slower method." >&2
    }
    
    if [ ! -f "$PLOCATE_DB" ]; then
      echo "Warning: plocate database was not created. Search may be slower." >&2
    else
      echo "Plocate database created successfully at $PLOCATE_DB" >&2
      # Show database size
      db_size=$(du -h "$PLOCATE_DB" | cut -f1)
      echo "Database size: $db_size" >&2
    fi
  fi
else
  echo "No allowed directories provided for indexing. Plocate will not be used." >&2
  echo "Directories may be provided later via MCP roots protocol." >&2
fi

# Export the database path for the Node.js process
export PLOCATE_DB

# Start the Node.js server with the original arguments
exec node /app/dist/index.js "$@"

