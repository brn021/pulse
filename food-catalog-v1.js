/* Checked-in public food references. Pure functions shared by the browser and Node. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.PulseFoodCatalog = factory();
})(globalThis, function () {
  "use strict";
  const version = 1;
  const categories = Object.freeze({ grains: "Grains", fruit: "Fruit", dairy: "Dairy", poultry: "Poultry" });
  const fruitSource = "https://www.ars.usda.gov/ARSUserFiles/80400535/Data/SR/SR28/reports/sr28fg09.pdf";
  const foods = [
    { id: "white-rice-cooked", name: "Cooked white rice", category: "grains", aliases: ["arroz cozido", "arroz branco", "cooked rice"],
      per100: { kcal: 130, protein: 2.69, carbs: 27.77, fat: 0.28 }, units: [],
      source: "USDA SR28 20045", url: "https://www.ars.usda.gov/ARSUserFiles/80400535/Data/SR/SR28/reports/sr28fg20.pdf",
      note: "Generic cooked long-grain white rice, no added oil. Carbs exclude fibre." },
    { id: "raspberries-raw", name: "Raspberries", category: "fruit", aliases: ["framboesas", "framboesa", "raspberry"],
      per100: { kcal: 52, protein: 1.20, carbs: 5.44, fat: 0.65 }, units: [],
      source: "USDA SR28 09302", url: fruitSource, note: "Generic raw, unsweetened fruit. Carbs exclude fibre." },
    { id: "strawberries-raw", name: "Strawberries", category: "fruit", aliases: ["morangos", "morango", "strawberry"],
      per100: { kcal: 32, protein: 0.67, carbs: 5.68, fat: 0.30 }, units: [],
      source: "USDA SR28 09316", url: fruitSource, note: "Generic raw, unsweetened fruit. Carbs exclude fibre." },
    { id: "charleville-medium-red-slices", name: "Charleville High Protein Medium Red", category: "dairy", aliases: ["queijo charleville", "charleville red cheddar", "fatias queijo"],
      per100: { kcal: 302, protein: 28, carbs: 0.25, fat: 22 },
      units: [{ id: "slice", label: "Slices", grams: 20, count: 1, estimated: false }],
      source: "Charleville Medium Red 160 g pack label", url: "https://www.tesco.ie/shop/en-IE/products/307365461",
      note: "Label: 20 g per slice. Carbs are <0.1 g per slice; 0.05 g is used for calculation." },
    { id: "rosie-jim-battered-chunks-400g", name: "Rosie & Jim Battered Chicken Chunks", category: "poultry", aliases: ["nuggets", "chicken chunks", "rosie and jim", "pedaços de frango"],
      per100: { kcal: 162, protein: 15.7, carbs: 14.5, fat: 4.4 },
      units: [{ id: "piece", label: "Pieces", grams: 110, count: 3, estimated: true }, { id: "portion", label: "Portions", grams: 110, count: 1, estimated: true }],
      source: "Rosie & Jim 400 g pack label", url: "https://www.tesco.ie/shop/en-IE/products/312237107",
      note: "The pack uses about 110 g for 3 pieces (1 portion). Sizes vary; use weighed grams if available." }
  ];
  for (const food of foods) {
    Object.freeze(food.aliases); Object.freeze(food.per100);
    food.units.forEach(Object.freeze); Object.freeze(food.units); Object.freeze(food);
  }
  Object.freeze(foods);
  const get = id => foods.find(food => food.id === id);
  const fold = value => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
  function search(query, category = "") {
    const terms = fold(query).split(/\s+/).filter(Boolean);
    return foods.filter(food => {
      const text = fold([food.name, food.id, ...food.aliases].join(" "));
      return (!category || food.category === category) && terms.every(term => text.includes(term));
    });
  }
  function decimal(value) {
    if (typeof value !== "number" && typeof value !== "string") return NaN;
    const text = String(value).trim();
    return /^(?:\d+[.,]?\d*|[.,]\d+)$/.test(text) ? Number(text.replace(",", ".")) : NaN;
  }
  const round = value => Math.round((value + Number.EPSILON * Math.max(1, value)) * 100) / 100;
  function calculate(id, amount, unit = "g", override = "") {
    const food = get(id);
    if (!food) throw new Error("Choose a catalog food.");
    const measure = food.units.find(item => item.id === unit);
    if (unit !== "g" && !measure) throw new Error("This food has no weight reference for that unit.");
    const n = decimal(amount);
    const hasOverride = unit !== "g" && String(override ?? "").trim() !== "";
    if (!hasOverride && (!Number.isFinite(n) || n <= 0)) throw new Error("Enter a positive quantity.");
    const grams = hasOverride ? decimal(override) : measure ? n * measure.grams / measure.count : n;
    if (!Number.isFinite(grams) || grams < 0.01 || grams > 100000) throw new Error("Enter a weight between 0.01 and 100000 g.");
    const estimated = Boolean(measure?.estimated && !hasOverride);
    const shownGrams = Math.abs(round(grams)-grams) > 1e-9 ? "≈" + round(grams) : (estimated ? "≈" : "") + round(grams);
    return {
      id, grams, estimated, overridden: hasOverride,
      item: food.name + " (" + shownGrams + " g)",
      ...Object.fromEntries(Object.entries(food.per100).map(([key, value]) => [key, round(value * grams / 100)]))
    };
  }
  function formatFoodLine(result, date, meal) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !["Breakfast", "Lunch", "Snack", "Dinner"].includes(meal)) {
      throw new Error("Use YYYY-MM-DD and Breakfast, Lunch, Snack or Dinner.");
    }
    return ["FOOD", date, meal, result.item, result.kcal, result.protein, result.carbs, result.fat].join("|");
  }
  return Object.freeze({ version, categories, foods, get, search, calculate, formatFoodLine });
});
