function togglePhone() {
    const phone = document.getElementById('phone-number');
    phone.classList.toggle('blurred');
    phone.classList.toggle('visible');
    showCopyButton(phone);  // Show the copy button when visible
    autoHide(phone);  // Auto hide after 5 seconds
  }
  
  function toggleBlur(wrapper) {
    wrapper.classList.toggle('visible');
    showCopyButton(wrapper);  // Show the copy button when visible
    autoHide(wrapper);  // Auto hide after 5 seconds
  }
  
  function hbd(wrapper) {
    wrapper.classList.toggle('visible');
    showCopyButton(wrapper);  // Show the copy button when visible
    autoHide(wrapper);  // Auto hide after 5 seconds
  }
  
  function copyText(event, button) {
    event.stopPropagation(); // Prevent the toggle from happening
    const text = button.previousElementSibling.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const icon = button.querySelector('i');
      icon.classList.replace('fa-copy', 'fa-check');
      setTimeout(() => {
        icon.classList.replace('fa-check', 'fa-copy');
      }, 1500);
    });
    autoHide(button);  // Auto hide button after 5 seconds
  }
  
  // Function to show the copy button
  function showCopyButton(element) {
    const button = element.querySelector('.copy-btn');
    if (button) {
      button.style.display = 'inline-block';  // Ensure the copy button is shown
    }
  }
  
  // Function to automatically hide the content and icon after 5 seconds
  function autoHide(element) {
    setTimeout(() => {
      if (element.classList.contains('visible')) {
        element.classList.remove('visible');
      }
      if (element.classList.contains('blurred')) {
        element.classList.remove('blurred');
      }
  
      // Reset the icon back to copy when content is hidden
      const button = element.querySelector('.copy-btn');
      if (button) {
        const icon = button.querySelector('i');
        icon.classList.replace('fa-check', 'fa-copy');  // Reset the icon to copy
        button.style.display = 'none';  // Hide the copy button after 5 seconds
      }
    }, 5000);  // 5000ms = 5 seconds
  }
  