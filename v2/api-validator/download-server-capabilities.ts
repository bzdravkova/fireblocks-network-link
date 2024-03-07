/**
 * This script downloads the server capabilities and saves them into JSON files
 * in the `capabilities-<hostname>` directory.
 */

import fs from 'fs';
import path from 'path';

import ApiClient from './src/client';
import config from './src/config';
import { loadOpenApiSchemas } from './src/schemas';
import { arrayFromAsyncGenerator, Pageable, paginated } from './tests/utils/pagination';

function getDownloadDir() {
  const url = new URL(config.get('client').serverBaseUrl);
  return `capabilities-${url.hostname}`;
}

type DownloadFn = () => Promise<Record<string, any>>;

async function downloadJsonFile(fileName: string, download: DownloadFn) {
  console.log(`📥 Downloading ${fileName}...`);

  const data = await download();
  const jsonText = JSON.stringify(data, null, 2);

  const filePath = path.join(getDownloadDir(), fileName + '.json');
  fs.writeFileSync(filePath, jsonText);
}

async function downloadCapabilities() {
  await loadOpenApiSchemas(config.getUnifiedOpenApiPathname());

  console.log(`Downloading server capabilities into ${getDownloadDir()}\n`);

  fs.rmSync(getDownloadDir(), { recursive: true, force: true });
  fs.mkdirSync(getDownloadDir());

  const client = new ApiClient();

  await downloadJsonFile('capabilities', () => client.capabilities.getCapabilities({}));

  const makeDownloader =
    <T>(f: Pageable<T>) =>
    () =>
      arrayFromAsyncGenerator(paginated(f));

  const getAdditionalAssets = makeDownloader(async (limit: number, startingAfter?: string) => {
    const response = await client.capabilities.getAdditionalAssets({ limit, startingAfter });
    return response.assets;
  });
  await downloadJsonFile('assets', getAdditionalAssets);

  const getBooks = makeDownloader(async (limit: number, startingAfter?: string) => {
    const response = await client.capabilities.getBooks({ limit, startingAfter });
    return response.books;
  });
  await downloadJsonFile('books', getBooks);

  const getAccounts = makeDownloader(async (limit: number, startingAfter?: string) => {
    const response = await client.accounts.getAccounts({ limit, startingAfter, balances: true });
    return response.accounts;
  });
  await downloadJsonFile('accounts', getAccounts);

  for (const { id } of await getAccounts()) {
    const getDepositMethods = makeDownloader(async (limit: number, startingAfter?: string) => {
      const response = await client.capabilities.getDepositMethods({
        accountId: id,
        limit,
        startingAfter,
      });
      return response.capabilities;
    });
    await downloadJsonFile(`deposits-${id}`, getDepositMethods);

    const getWithdrawalMethods = makeDownloader(async (limit: number, startingAfter?: string) => {
      const response = await client.capabilities.getWithdrawalMethods({
        accountId: id,
        limit,
        startingAfter,
      });
      return response.capabilities;
    });
    await downloadJsonFile(`withdrawals-${id}`, getWithdrawalMethods);
  }
}

downloadCapabilities()
  .then(() => console.log('\n✅ Capabilities downloaded successfully'))
  .catch((e) => console.error('\n❌ Capabilities failed to download:\n', e));
