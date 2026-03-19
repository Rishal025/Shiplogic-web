export interface Item {
  _id: string;
  itemCode: string;
  description: string;
  riceName?: string;
  variant?: string;
  barcode?: string;
  hsCode?: string;
  packing: string;
  bagWeightKg: number | null;
  unit: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface ItemListResponse {
  page: number;
  limit: number;
  totalPages: number;
  totalRecords: number;
  items: Item[];
}
