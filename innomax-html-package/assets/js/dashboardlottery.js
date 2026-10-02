async function getLotteryData() {
try {
      const response = await fetch('/api/lottery/lotteryUserData');
      if (!response.ok) {
        throw new Error(`Erreur ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Erreur lors de la récupération des données:', error);
      return null;
    }
  }

  window.addEventListener('DOMContentLoaded', getLotteryData);