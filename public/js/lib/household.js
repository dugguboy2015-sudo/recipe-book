let cached = null;
let pending = null;

export async function getHousehold() {
  if (cached) return cached;
  if (!pending) {
    pending = fetch('/config/household.json')
      .then((res) => res.json())
      .then((data) => {
        cached = data;
        return data;
      })
      .catch((err) => {
        console.error('Failed to load household.json', err);
        pending = null;
        throw err;
      });
  }
  return pending;
}
