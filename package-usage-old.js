import fetch from "node-fetch";
import fs from "fs";

const companyName = process.argv[2];
const packageName = process.argv[3];
const azureToken = process.argv[4];

const token = `Basic ${Buffer.from(`:${azureToken}`).toString("base64")}`;

const API_URL = `https://almsearch.dev.azure.com/${companyName}/_apis/search/codeQueryResults?api-version=6.0-preview.1`;

// const search = async (packageName, skip, projectName) => {
//   const response = await fetch(API_URL, {
//     method: "POST",
//     body: JSON.stringify({
//       searchText: packageName,
//       skipResults: skip,
//       takeResults: 200,
//       filters: [],
//       searchFilters: projectName ? { ProjectFilters: [projectName] } : {},
//       sortOptions: [],
//       summarizedHitCountsNeeded: true,
//       includeSuggestions: false,
//       isInstantSearch: false,
//     }),
//     headers: { Authorization: token, "Content-Type": "application/json" },
//   });
//   const responseJson = await response.json();
//   return responseJson;
// };

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

const packages = [
  "@itwin/itwinui-css",
  "@itwin/itwinui-react",
  "@itwin/itwinui-layouts-css",
  "@itwin/itwinui-layouts-react",
  "@itwin/itwinui-variables",
  "@itwin/itwinui-icons-react",
  "@itwin/itwinui-illustrations-react",
];

const today = new Date().toJSON().slice(0, 10);

const getFileContent = async (file) => {
  try {
    const response = await fetch(
      `https://dev.azure.com/${companyName}/${
        file.projectId
      }/_apis/git/repositories/${file.repositoryId}/Items?path=${encodeURI(
        file.path
      )}&recursionLevel=0&includeContentMetadata=true&latestProcessedChange=false&download=false&versionDescriptor%5BversionOptions%5D=0&versionDescriptor%5BversionType%5D=2&versionDescriptor%5Bversion%5D=${
        file.changeId
      }&includeContent=true&resolveLfs=true`,
      {
        method: "GET",
        headers: { Authorization: token, "Content-Type": "application/json" },
      }
    );
    return await response.text();
  } catch (err) {
    console.log(err);
  }
};

const findPackageVersion = async (file, packageName) => {
  try {
    const content = await getFileContent(file);
    const obj = JSON.parse(content);
    var version;
    if (obj.dependencies && obj.dependencies[packageName]) {
      version = obj.dependencies[packageName];
      return version;
    } else if (obj.devDependencies && obj.devDependencies[packageName]) {
      version = obj.devDependencies[packageName];
      return version;
    }
  } catch (err) {
    console.log(err);
  }
};

const search = async (packageName, skip, projectName, repositoryName) => {
  const filter = {};
  if (projectName) {
    filter.ProjectFilters = [projectName];
  }
  if (repositoryName) {
    filter.RepositoryFilters = [repositoryName];
  }
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        searchText: packageName,
        skipResults: skip,
        takeResults: 200,
        filters: [],
        searchFilters: filter,
        sortOptions: [],
        summarizedHitCountsNeeded: true,
        includeSuggestions: false,
        isInstantSearch: false,
      }),
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    const responseJson = await response.json();
    return responseJson;
  } catch (err) {
    console.log(err);
  }
};

const processData = (data) => {
  // fs.writeFileSync(`./packageusage-repos-all.csv`, "repo name \n");
  packages.forEach((pkg) => {
    process.stdout.write(`\r Processing ${pkg} versions count \n`);
    const versionUsage = {};
    var packageCount = [];
    console.log(packageCount.length);
    data
      .filter((item) => item.package === pkg)
      .map((item) => {
        const newVersion = item.version ? item.version.replace('^','').replace('~',''): item.version;
        console.log(newVersion);
        if (
          newVersion !== undefined &&
          packageCount.indexOf(item.name) === -1
        ) {
          packageCount.push(item.name);
          if (versionUsage[newVersion]) {
            versionUsage[newVersion]++;
          } else {
            versionUsage[newVersion] = 1;
          }
        }
      });

    // console.log(packageCount);
    for (const [key, value] of Object.entries(versionUsage)) {
      fs.appendFileSync(
        `./packageusage-${pkg.split("/")[1]}-all.csv`,
        `${today}, ${pkg}, ${key}, ${value} \n`
      );
    }
    fs.appendFileSync(
      `./packageusage-all.csv`,
      `${today}, ${pkg}, ${packageCount.length} \n`
    );
    // packageCount.forEach((item) =>
    //   fs.appendFileSync(`./packageusage-repos-all.csv`, `${item} \n`)
    // );
  });
};

const getUsageForPackage = async (packageName) => {
  const initialResponse = await search(packageName, 0);
  const totalCount = initialResponse.results.count;
  let resultsProcessed = 0;
  const projects = initialResponse.filterCategories[0].filters.map(
    (filter) => filter.id
  );
  const projectResults = initialResponse.filterCategories[0].filters.map(
    (filter) => filter.resultCount
  );
  const appsUsing = [];

  for (let i = 0; i < projects.length; i++) {
    try {
      const projectName = projects[i];
      const initialProjectResponse = await search(packageName, 0, projectName);
      const repositories =
        initialProjectResponse.filterCategories[1].filters.map(
          (filter) => filter.id
        );
      const repositoriesResults =
        initialProjectResponse.filterCategories[1].filters.map(
          (filter) => filter.resultCount
        );
      for (let j = 0; j < repositories.length; j++) {
        const repositoryName = repositories[j];
        let skip = 0;
        while (skip < repositoriesResults[j]) {
          const response = await search(
            packageName,
            skip,
            projectName,
            repositoryName
          );

          response.results.values
            .filter((val) => {
              return val.fileName === "package.json";
            })
            .map(async (val) => {
              // return appsUsing.push(val.repository);
              packages.map(async (pkg) => {
                await findPackageVersion(val, pkg).then((version) => {
                  appsUsing.push({
                    date: today,
                    name: val.repository,
                    version: version,
                    package: pkg,
                  });
                });
              });
            });

          skip = response.results.values.length + skip;
          resultsProcessed += response.results.values.length;
          process.stdout.write(
            `\r${packageName}: ${resultsProcessed} out of ${totalCount} files scanned.`
          );
        }
      }
    } catch (err) {
      console.log(err);
    }
  }
  process.stdout.write(`\n`);
  // console.log(appsUsing);

  var unique = appsUsing.filter(onlyUnique);
  console.log(unique);
  fs.writeFileSync(
    `./packageusage-${packageName}-${today}-raw.json`,
    `${JSON.stringify(appsUsing)} \n`
  );

  // fs.writeFileSync(`./packageusage-all.csv`, "date, package, version, count \n");
  processData(appsUsing);
};

const main = async () => {
  try {
    await getUsageForPackage(packageName);
  } catch (error) {
    console.error(
      "Something went wrong. It might be that your token expired.",
      error
    );
  }
};

main();
