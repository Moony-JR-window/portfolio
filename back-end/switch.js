const btn = document.getElementById("yearToggle");
const content = document.getElementById("aboutContent");

let year = 2025;

const about2025 = `
<p>
I am a junior web and mobile app full-stack developer
in my final year of Computer Science at the Royal University
of Phnom Penh (RUPP).
</p>
<p>
I have developed my skills through extensive internet research
and hands-on projects focusing on front-end, back-end,
and automation testing technologies.
</p>
`;

const about2026 = `
<p>
I am a QA Engineer with a strong foundation in full-stack web
and mobile application development. I graduated in Computer Science
from the Royal University of Phnom Penh.
</p>
<p>
My background in front-end and back-end development helps me understand
system architecture, code quality, and application workflows while
focusing on automation testing and software quality.
</p>
`;

btn.addEventListener("click", () => {

  // reset animation state
  content.classList.remove("slide-left-out","slide-right-out","slide-reset");
  void content.offsetWidth; // force reflow (important)

  if(year === 2025){

    content.classList.add("slide-left-out");

    setTimeout(() => {
      content.innerHTML = about2026;
      content.classList.remove("slide-left-out");
      content.classList.add("slide-reset");
      btn.textContent = "2026";
      year = 2026;
    },250);

  }else{

    content.classList.add("slide-right-out");

    setTimeout(() => {
      content.innerHTML = about2025;
      content.classList.remove("slide-right-out");
      content.classList.add("slide-reset");
      btn.textContent = "2025";
      year = 2025;
    },250);

  }

});



// const btn = document.getElementById("yearToggle");
const tip = document.getElementById("yearTip");

// variable to track if tip has been shown
let tipShown = false;

window.addEventListener("load", () => {
  if(!tipShown){
    tip.classList.add("show");

    setTimeout(()=>{
      tip.classList.remove("show");
      tipShown = true; // mark as shown
    }, 70000);
  }
});