# check if AREA verialbei is set else make error
if [ -z "${AREA:-}" ]; then
  echo "Error: AREA environment variable is not set. Please set it to the desired area (e.g., 'germany')."
  exit 1
fi

