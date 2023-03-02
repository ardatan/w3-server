import type Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import { PromiseOrValue, Response, RouterPlugin, RouterRequest } from '../types';

type ValidateRequestFn = (request: RouterRequest) => PromiseOrValue<ErrorObject[]>;

export interface AJVPluginOptions {
  ajv: Ajv;
}

export function useAjv({ ajv }: AJVPluginOptions): RouterPlugin<any> {
  return {
    onRoute({ schemas, handlers }) {
      const validationMiddlewares = new Map<string, ValidateRequestFn>();
      if (schemas?.request?.headers) {
        const validateFn = ajv.compile(schemas.request.headers);
        validationMiddlewares.set('headers', request => {
          const headersObj: any = {};
          request.headers.forEach((value, key) => {
            headersObj[key] = value;
          });
          const isValid = validateFn(headersObj);
          if (!isValid) {
            return validateFn.errors!;
          }
          return [];
        });
      }
      if (schemas?.request?.params) {
        const validateFn = ajv.compile(schemas.request.params);
        validationMiddlewares.set('params', request => {
          const isValid = validateFn(request.params);
          if (!isValid) {
            return validateFn.errors!;
          }
          return [];
        });
      }
      if (schemas?.request?.query) {
        const validateFn = ajv.compile({
          ...schemas.request.query,
          $async: true,
        });
        validationMiddlewares.set('query', request => {
          const isValid = validateFn(request.query);
          if (!isValid) {
            return validateFn.errors!;
          }
          return [];
        });
      }
      if (schemas?.request?.json) {
        const validateFn = ajv.compile(schemas.request.json);
        validationMiddlewares.set('json', async request => {
          if (request.headers.get('content-type').includes('json')) {
            const jsonObj = await request.json();
            Object.defineProperty(request, 'json', {
              value: async () => jsonObj,
            });
            const isValid = validateFn(jsonObj);
            if (!isValid) {
              return validateFn.errors!;
            }
          }
          return [];
        });
      }
      if (schemas?.request?.formData) {
        const validateFn = ajv.compile(schemas.request.formData);
        validationMiddlewares.set('formData', async request => {
          const contentType = request.headers.get('content-type');
          if (
            contentType.includes('multipart/form-data') ||
            contentType.includes('application/x-www-form-urlencoded')
          ) {
            const formData = await request.formData();
            const formDataObj: Record<string, FormDataEntryValue> = {};
            const jobs: Promise<void>[] = [];
            formData.forEach((value, key) => {
              if (typeof value === 'string') {
                formDataObj[key] = value;
              } else {
                jobs.push(
                  value.arrayBuffer().then(buffer => {
                    const typedArray = new Uint8Array(buffer);
                    const binaryStrParts: string[] = [];
                    typedArray.forEach((byte, index) => {
                      binaryStrParts[index] = String.fromCharCode(byte);
                    });
                    formDataObj[key] = binaryStrParts.join('');
                  }),
                );
              }
            });
            await Promise.all(jobs);
            Object.defineProperty(request, 'formData', {
              value: async () => formDataObj,
            });
            const isValid = validateFn(formDataObj);
            if (!isValid) {
              return validateFn.errors!;
            }
          }
          return [];
        });
      }
      if (validationMiddlewares.size > 0) {
        handlers.unshift(async (request): Promise<any> => {
          const validationErrorsNonFlat = await Promise.all(
            [...validationMiddlewares.entries()].map(async ([name, fn]) => {
              const errors = await fn(request);
              if (errors.length > 0) {
                return errors.map(error => ({
                  name,
                  ...error,
                }));
              }
            }),
          );
          const validationErrors = validationErrorsNonFlat.flat().filter(Boolean) as ErrorObject[];
          if (validationErrors.length > 0) {
            return Response.json(
              {
                errors: validationErrors,
              },
              {
                status: 400,
                headers: {
                  'x-error-type': 'validation',
                },
              },
            );
          }
        });
      }
    },
  };
}
