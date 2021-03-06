import fs from "@skpm/fs";
import path from "path";
import { getCurrentFileName, getCurrentDirectory, exec } from "./common";

function findUpward(fileName, currentDirectory) {
  if (fs.existsSync(path.join(currentDirectory, fileName))) {
    return fs.readFileSync(path.join(currentDirectory, fileName), "utf8");
  }
  if (
    !currentDirectory ||
    currentDirectory === "/" ||
    currentDirectory === "."
  ) {
    return "";
  }
  return findUpward(fileName, path.dirname(currentDirectory));
}

export function exportArtboards(prefs) {
  const currentFileName = getCurrentFileName();
  const currentDirectory = getCurrentDirectory();
  const currentFileNameWithoutExtension = currentFileName.replace(
    /\.sketch$/,
    ""
  );
  const {
    exportFolder,
    exportFormat: prefsExportFormat,
    exportScale,
    includeOverviewFile,
  } = prefs;
  const exportFormat = prefsExportFormat || "png";
  const bundlePath = NSBundle.mainBundle().bundlePath();
  const fileFolder = path.join(
    currentDirectory,
    exportFolder,
    currentFileNameWithoutExtension
  );

  // get list of artboards regex to ignore
  const sketchIgnore = findUpward(".sketchignore", currentDirectory)
    .split("\n")
    .filter((x) => x.trim())
    .map((x) => new RegExp(x));

  // get list of artboard names to export
  const artboards = [];
  const sketchtoolOutput = JSON.parse(
    exec(
      `"${bundlePath}/Contents/Resources/sketchtool/bin/sketchtool" list artboards "${currentFileName}" --include-symbols=YES`
    )
  );
  sketchtoolOutput.pages.forEach((page) => {
    page.artboards.forEach((artboard) => {
      const name = page.name + "/" + artboard.name;
      if (sketchIgnore.every((regex) => !regex.test(name))) {
        artboards.push(artboard.name);
      }
    });
  });

  artboards.sort((a, b) => {
    const upperA = a.toUpperCase();
    const upperB = b.toUpperCase();
    if (upperA < upperB) {
      return -1;
    }
    if (upperA > upperB) {
      return 1;
    }
    return 0;
  });

  try {
    fs.mkdirSync(exportFolder, { recursive: true });
  } catch (err) {
    // ignore
  }

  // move old artboards to temp directory to compare them with the new ones
  try {
    fs.rmdirSync(path.join(currentDirectory, ".oldArtboards"));
  } catch (err) {
    // ignore
  }
  try {
    fs.renameSync(fileFolder, path.join(currentDirectory, ".oldArtboards"));
  } catch (err) {
    // ignore
  }
  try {
    fs.rmdirSync(fileFolder);
    fs.unlinkSync(fileFolder);
  } catch (err) {
    // ignore
  }

  console.log(artboards);

  // generate new artboards
  fs.mkdirSync(fileFolder, { recursive: true });
  const command = `"${bundlePath}/Contents/Resources/sketchtool/bin/sketchtool" export artboards "${currentFileName}" --formats="${
    exportFormat
  }" --scales="${exportScale}" --output="${fileFolder}" --overwriting=YES --items="${artboards.join(
    ","
  )}" --include-symbols=YES`
  console.log(command);
  exec(command);

  // Construct a ${FILENAME}-boards.md file which shows all the artboards in the sketch directory
  const readmeFile = path.join(
    currentDirectory,
    `./${currentFileName.replace(".sketch", "")}-boards.md`
  ); // Exclude the file extension
  if (includeOverviewFile) {
    fs.writeFileSync(
      readmeFile,
      `# Artboards

This is an autogenerated file showing all the artboards. Do not edit it directly.`
    );
  }



  // compare new artboards with the old ones
  artboards.forEach((artboard) => {
    const artboardFileName = `${artboard}.${exportFormat}`
    if (fs.existsSync(path.join(currentDirectory, ".oldArtboards", artboardFileName))) {
      const newArtboardPath = path.join(fileFolder, artboardFileName);
      const oldArtboardPath = path.join(currentDirectory, ".oldArtboards", artboardFileName);
      const newArtboard = fs.readFileSync(newArtboardPath);
      const oldArtboard = fs.readFileSync(oldArtboardPath);

      if (newArtboard.equals(oldArtboard)) {
        // keep the old artboard
        fs.unlinkSync(newArtboardPath);
        fs.renameSync(oldArtboardPath, newArtboardPath);
      }
    }

    if (includeOverviewFile) {
      const artboardPathUrlEncoded = encodeURIComponent(
        `${exportFolder}/${currentFileNameWithoutExtension}/${artboardFileName}`
      );
      fs.appendFileSync(
        readmeFile,
        `
## ${artboard}

![${artboard}](./${artboardPathUrlEncoded})
`
      );
    }
  });

  exec(`git add "${exportFolder}"`);

  if (includeOverviewFile) {
    exec(`git add "${readmeFile}"`);
  }

  try {
    fs.rmdirSync(path.join(currentDirectory, ".oldArtboards"));
  } catch (err) {
    // ignore
  }
}
