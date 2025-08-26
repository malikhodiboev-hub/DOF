
export function calcPoints({ isNewPlate, isFirstToday }) {
  let points = 0;
  if (isNewPlate) points += 10;
  if (isFirstToday) points += 5;
  return points;
}
