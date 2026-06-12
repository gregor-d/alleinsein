// dev-drawer.js
document.addEventListener('DOMContentLoaded', () => {
    const buttons = document.querySelectorAll('.dev-pos-btn');
    const drawer = document.getElementById('settings-drawer');
    
    // Set default position
    let currentPos = 'right-middle';
    if (drawer) {
        drawer.dataset.pos = currentPos;
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            currentPos = btn.dataset.pos;
            if (drawer) {
                drawer.dataset.pos = currentPos;
            }
        });
    });
});
