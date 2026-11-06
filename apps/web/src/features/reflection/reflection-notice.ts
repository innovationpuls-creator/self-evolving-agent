// Matches the `availability` field of the Host reflection catalog: `checkedAt` exists once a check has completed.
type Availability = { available: boolean; reason?: string; checkedAt?: number };

// Until the Host records its first environment check, that check runs on its own once Agent work allows it.
export const environmentChecked = (availability: Availability) => 'checkedAt' in availability;
export const environmentNotice = (availability: Availability) =>
  availability.available ? undefined : environmentChecked(availability) ? '自动复盘暂不可用' : '尚未检查自动复盘环境';
export const uncheckedPollMs = 5000;
