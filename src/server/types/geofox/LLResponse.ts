export interface LLResponse {
  dataReleaseID: string;
  lines: LineListEntry[];
}

export interface LineListEntry {
  id: string;
  name: string;
  carrierNameShort: string;
  carrierNameLong: string;
  sublines: SublineListEntry[];
  exists: boolean;
}

interface SublineListEntry {
  sublineNumber: string;
  vehicleType: string;
  stationSequence: StationLight[];
}

interface StationLight {
  id: string;
  name: string;
}
