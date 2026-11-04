// Qaysi panel ochilgan: ega.ariqalqon.uz — Super Admin, qolgani — salon paneli.
// Haqiqiy ajratishni server qiladi (backend/app/core/panels.py), bu faqat ko'rinish uchun.
export const isAdminHost = /^(www\.)?ega\./.test(window.location.hostname);
