import { handleWebApi } from "../dist/src/web-api/http.js";

export default function handler(request, response) {
  return handleWebApi(request, response);
}
