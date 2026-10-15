/* 배포 후 이 파일만 고치면 됩니다. */
window.SITE = {
  // Apps Script 웹 앱 배포 URL (예: https://script.google.com/macros/s/XXXX/exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbwumh31zWCwervJ5bdcb3mQ2En8Xx2IwuP86Em2f-J7kS5dnbnNSvi7TUyHbZwv-I6B/exec',

  // 참가비 이체 안내 (결제 기능은 없음). number 가 비어 있으면 안내 칸이 보이지 않습니다.
  ACCOUNT: { bank: '', number: '', holder: '' },

  // 발제집 전자책(PDF) 주소. 비어 있으면 "공개 예정" 안내가 보입니다.
  // 예: 'proceedings/2026-proceedings.pdf' (저장소에 올린 경우)
  PROCEEDINGS_URL: '',

  // 문의 메일 (비워 두면 표시하지 않음)
  CONTACT_EMAIL: ''
};
