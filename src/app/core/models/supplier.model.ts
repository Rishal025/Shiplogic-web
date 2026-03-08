export interface Supplier {
  _id: string;
  supplierCode: string;
  name: string;
  country: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

export interface SupplierListResponse {
  page: number;
  limit: number;
  totalPages: number;
  totalRecords: number;
  suppliers: Supplier[];
}
