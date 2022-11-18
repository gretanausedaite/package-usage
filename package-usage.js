import fetch from "node-fetch";
import writeXlsxFile from "write-excel-file";
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

const packages = [
  "@itwin/itwinui-css",
  "@itwin/itwinui-react",
  "@itwin/itwinui-layouts-css",
  "@itwin/itwinui-layouts-react",
  "@itwin/itwinui-variables",
  "@itwin/itwinui-icons-react",
  "@itwin/itwinui-illustrations-react",
];

const getFileContent = async (file) => {
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
};

const findPackageVersion = async (file, packageName) => {
  const content = await getFileContent(file);
  const obj = JSON.parse(content);
  var version;
  try {
    if (obj.devDependencies) {
      version = obj.devDependencies[packageName];
    }
    if (obj.dependencies) {
      version = obj.dependencies[packageName];
    }
  } catch (err) {
    console.log(err);
  }
  return version;
};

const search = async (packageName, skip, projectName, repositoryName) => {
  const filter = {};
  if (projectName) {
    filter.ProjectFilters = [projectName];
  }
  if (repositoryName) {
    filter.RepositoryFilters = [repositoryName];
  }
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
};

const proccessData = (data) => {
  const versionUsage = [];
  data.map((item) => {
    if (item.package === "@itwin/itwinui-react") {
      if (versionUsage[item.version]) {
        versionUsage[item.version]++;
      } else {
        versionUsage[item.version] = 1;
      }
    }
  });
  console.log(versionUsage);
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
              // return val.repository;
              packages.map(async (pkg) => {
                await findPackageVersion(val, pkg).then((version) => {
                  appsUsing.push({
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
  console.log(appsUsing);
  proccessData(appsUsing);
  fs.writeFileSync(
    `./packageusage-${packageName}.json`,
    JSON.stringify(appsUsing)
  );
  // await writeExcelFile(appsUsing);
};

const writeExcelFile = async (data) => {
  const schema = [
    {
      column: "Date",
      type: Date,
      value: new Date(),
    },
    {
      column: "Repository",
      type: String,
      format: "mm/dd/yyyy",
      value: (item) => item.name,
    },
    {
      column: "Version",
      type: String,
      value: (item) => item.version,
    },
  ];

  await writeXlsxFile(data, {
    schema,
    fileName: "file.xlsx",
  });
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
