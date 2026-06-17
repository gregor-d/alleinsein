# check that gdal is installed and available if not install it
if ! command -v gdal --version &> /dev/null; then
    echo "Error: GDAL is not installed or not in the system PATH."    
    # install gdal using apt-get
    if command -v apt-get &> /dev/null; then
        echo "Attempting to install GDAL using apt-get..."
        sudo apt-get update
        sudo apt-get install -y gdal-bin libgdal-dev python3-gdal
    else
        echo "Error: apt-get is not available. With ubuntu add GIS ppa repository and install GDAL from there."
        echo "sudo add-apt-repository ppa:ubuntugis/ppa"
        echo "sudo apt update"
        echo "sudo apt install gdal-bin libgdal-dev python3-gdal"
        echo "Continuing without installing GDAL."
    fi  
else
    echo "GDAL is already installed."
fi

# check that osmium-tool is installed and available if not install it
if ! command -v osmium &> /dev/null; then
    echo "Error: osmium-tool is not installed or not in the system PATH."
    # install osmium-tool using apt-get
    if command -v apt-get &> /dev/null; then
        echo "Attempting to install osmium-tool using apt-get..."
        sudo apt-get update
        sudo apt-get install -y osmium-tool
    else
        echo "Error: apt-get is not available. Install osmium-tool manually."
        echo "Ubuntu/Debian: sudo apt install osmium-tool"
        echo "macOS/Homebrew: brew install osmium-tool"
        echo "Continuing without installing osmium-tool."
    fi
else
    echo "osmium-tool is already installed."
fi

# check if uv is installed
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed or not in the system PATH."
    echo "Installing with curl -LsSf https://astral.sh/uv/install.sh | sh"
    sudo curl -LsSf https://astral.sh/uv/install.sh | sh
else
    echo "uv is already installed."
fi

# install dependencies
echo "Creating virtual environment and installing dependencies with uv..."
uv sync

echo "Installing pre-commit hooks..."
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg

echo "Enter virtual environment:"
echo ".venv/bin/activate"
