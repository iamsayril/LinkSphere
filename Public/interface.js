const revealElements = document.querySelectorAll(".reveal");

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("show");
    }
  });
}, {
  threshold: 0.15
});

revealElements.forEach(el => revealObserver.observe(el));

const navItems = document.querySelectorAll(".bottom-nav a");

navItems.forEach(item => {
  item.addEventListener("click", e => {
    e.preventDefault();

    navItems.forEach(nav => nav.classList.remove("active"));
    item.classList.add("active");
  });
});

const cards = document.querySelectorAll(".action-card");

cards.forEach(card => {
  card.addEventListener("mousemove", e => {
    const rect = card.getBoundingClientRect();

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotateX = (y - rect.height / 2) / -25;
    const rotateY = (x - rect.width / 2) / 25;

    card.style.transform =
      `translateY(-10px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform = "";
  });
});