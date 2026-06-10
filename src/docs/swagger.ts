import { Express } from 'express';
import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import swaggerUi from 'swagger-ui-express';
import basicAuth from 'express-basic-auth';

export const setupDocs = (app: Express): void => {
    const docsUser = process.env.DOCS_USER as string;
    const docsPassword = process.env.DOCS_PASSWORD as string;

    const swaggerDocument = yaml.load(
        fs.readFileSync(path.join(__dirname, '../../openapi.yaml'), 'utf8')
    ) as object;

    app.use(
        '/docs',
        basicAuth({ users: { [docsUser]: docsPassword }, challenge: true }),
        swaggerUi.serve,
        swaggerUi.setup(swaggerDocument)
    );
};
