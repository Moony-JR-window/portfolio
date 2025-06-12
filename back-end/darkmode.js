// function Darkmode() {
//     const darkIcon = document.getElementById('darkIcon');
//     const body = document.body;
    
//     // Check for saved user preference
//     const isDark = localStorage.getItem('darkMode') === 'true';
    
//     // Apply saved preference or system preference
//     if (isDark || (!('darkMode' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
//         body.classList.add('dark-mode');
//         darkIcon.classList.replace('bi-moon-stars', 'bi-moon-stars-fill');
//     }
    
//     // Toggle function
//     darkIcon.addEventListener('click', () => {
//         body.classList.toggle('dark-mode');
        
//         if (body.classList.contains('dark-mode')) {
//             darkIcon.classList.replace('bi-moon-stars', 'bi-moon-stars-fill');
//             localStorage.setItem('darkMode', 'true');
//         } else {
//             darkIcon.classList.replace('bi-moon-stars-fill', 'bi-moon-stars');
//             localStorage.setItem('darkMode', 'false');
//         }
//     });
// }

// // Initialize
// Darkmode();
function setItem(key, value) {
  localStorage.setItem(key, value);
}

function getItem(key) {
  return localStorage.getItem(key);
}


function initializeDarkMode() {
    const darkIcon = document.getElementById('darkIcon');
    const body = document.body;
    
    // Check for saved user preference
    const savedTheme = getItem('theme');
    // Check system preference
    // const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Apply theme based on preferences
    if (savedTheme === 'dark' ) {
        body.classList.add('dark-mode');
        darkIcon.classList.replace('bi-moon-stars', 'bi-moon-stars-fill');
    }
    
    // Toggle function
    darkIcon.addEventListener('click', () => {
        body.classList.toggle('dark-mode');
        
        if (body.classList.contains('dark-mode')) {
            darkIcon.classList.replace('bi-moon-stars', 'bi-moon-stars-fill');
            setItem('theme', 'dark');
        } else {
            darkIcon.classList.replace('bi-moon-stars-fill', 'bi-moon-stars');
            setItem('theme', 'light');
        }
    });
}

initializeDarkMode()
