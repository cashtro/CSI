const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const inputRoot = path.join(__dirname, "assets/img");
const outputRoot = path.join(__dirname, "assets/img-optimized");

// Target sizes (based on type of folder)
const resizeRules = [
  { keyword: "icon", width: 92, quality: 60 },
  { keyword: "logo", width: 120, quality: 65 },
  { keyword: "testimonial", width: 100, quality: 65 },
  { keyword: "", width: 1200, quality: 70 }, // Default rule
];

// Recursively get all image files
function getAllImages(dirPath, files = []) {
  const entries = fs.readdirSync(dirPath);
  for (const file of entries) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllImages(fullPath, files);
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(file)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getRuleByPath(filePath) {
  for (const rule of resizeRules) {
    if (filePath.includes(rule.keyword)) return rule;
  }
  return resizeRules[resizeRules.length - 1]; // fallback
}

function optimizeImage(filePath) {
  const relativePath = path.relative(inputRoot, filePath);
  const outputPath = path.join(outputRoot, relativePath).replace(/\.[^/.]+$/, ".webp");

  const { width, quality } = getRuleByPath(filePath);

  sharp(filePath)
    .resize({ width })
    .webp({ quality })
    .toFile(outputPath)
    .then(() => console.log("✔️", outputPath))
    .catch((err) => console.error("❌", filePath, err));
}

// Start
const allImages = getAllImages(inputRoot);
allImages.forEach(optimizeImage);
