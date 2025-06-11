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

function setCookie(name, value, days = 365) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = `${name}=${value};${expires};path=/`;
  }
  
  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [cookieName, cookieValue] = cookie.trim().split('=');
      if (cookieName === name) return cookieValue;
    }
    return null;
  }
  

function initializeDarkMode() {
    const darkIcon = document.getElementById('darkIcon');
    const body = document.body;
    
    // Check for saved user preference
    const savedTheme = getCookie('theme');
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
            setCookie('theme', 'dark');
        } else {
            darkIcon.classList.replace('bi-moon-stars-fill', 'bi-moon-stars');
            setCookiem('theme', 'light');
        }
    });
}

initializeDarkMode()
