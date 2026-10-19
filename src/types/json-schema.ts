export interface JSONSchemaFieldOpts {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  required?: boolean;
  default?: any;
  enum?: string[];
  items?: JSONSchemaFieldOpts | { type: string; properties?: Record<string, any> } | { $ref: string };
  properties?: Record<string, any>;
  validator?: any;
}

export interface JSONSchemaOpts {
  name: string;
  description: string;
  fields: Record<string, JSONSchemaFieldOpts>;
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, any>;
  required: string[];
  additionalProperties: boolean;
  [key: string]: unknown;
}

export class JSONSchemaBuilder {
  static field(options: JSONSchemaFieldOpts): JSONSchemaFieldOpts {
    return options;
  }

  static buildSchema(opts: JSONSchemaOpts): JSONSchema {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, field] of Object.entries(opts.fields)) {
      const prop: any = {
        type: field.type,
        description: field.description,
      };

      if (field.enum) {
        prop.enum = field.enum;
      }
      if (field.default !== undefined) {
        prop.default = field.default;
      }

      if (field.type === 'array' && field.items) {
        if ('type' in field.items) {
          if ((field.items as any).properties) {
            const itemsType = field.items as { type: string; properties: Record<string, any> };
            prop.items = {
              type: itemsType.type,
              properties: itemsType.properties,
            };
          } else {
            prop.items = { type: (field.items as JSONSchemaFieldOpts).type };
          }
        } else if ('$ref' in field.items) {
          prop.items = field.items;
        } else {
          prop.items = field.items;
        }
      }

      if (field.type === 'object' && field.properties) {
        prop.properties = field.properties;
      }

      if (field.validator) {
        prop.validation = field.validator;
      }

      if (field.required) {
        required.push(key);
      }

      properties[key] = prop;
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }
}

export interface Schema {
  export(): JSONSchema;
}

export class SchemaImpl implements Schema {
  constructor(private opts: JSONSchemaOpts) {}

  export(): JSONSchema {
    return JSONSchemaBuilder.buildSchema(this.opts);
  }
}

export function defineSchema(opts: JSONSchemaOpts): Schema {
  return new SchemaImpl(opts);
}

export function field(options: JSONSchemaFieldOpts): JSONSchemaFieldOpts {
  return JSONSchemaBuilder.field(options);
}

export const validator = {
  number() {
    return {
      int() {
        const v: any = {
          min(n: number) {
            const r: any = { _min: n };
            r.min = (n2: number) => { r._max = n2; return r; };
            r.max = (n2: number) => { r._max = n2; return r; };
            return r;
          },
          max(n: number) {
            const r: any = { _max: n };
            r.min = (n2: number) => { r._min = n2; return r; };
            return r;
          },
        };
        return v;
      },
      min(n: number) {
        const r: any = { _min: n };
        r.max = (n2: number) => { r._max = n2; return r; };
        return r;
      },
      max(n: number) {
        const r: any = { _max: n };
        r.min = (n2: number) => { r._min = n2; return r; };
        return r;
      },
    };
  },
};
