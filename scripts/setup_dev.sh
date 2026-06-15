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
        exit 1  
    fi  
else
    echo "GDAL is already installed."
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

echo "Enter virtual environment:"
echo ".venv/bin/activate"
