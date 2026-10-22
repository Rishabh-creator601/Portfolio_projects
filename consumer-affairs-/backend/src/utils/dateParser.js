function parseMonthYear(rawText) {
  if (!rawText) return { month: null, year: null, format: null };
  // Simple regex for MM/YYYY, MM-YYYY, or Month YYYY
  const match = rawText.match(/(0?[1-9]|1[0-2])[\/\-](\d{4})|([a-zA-Z]+)\s+(\d{4})/);
  if (match) {
    if (match[1] && match[2]) {
      return { month: parseInt(match[1]), year: parseInt(match[2]), format: 'MM/YYYY' };
    } else if (match[3] && match[4]) {
      const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const m = match[3].substring(0,3).toLowerCase();
      const monthIdx = monthNames.indexOf(m) + 1;
      return { month: monthIdx, year: parseInt(match[4]), format: 'MMM YYYY' };
    }
  }
  return { month: null, year: null, format: null };
}

module.exports = {
  parseMonthYear
};
