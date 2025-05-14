import { GeneratorVisitor } from './GeneratorVisitor.js';
import { Arr, IType } from '../nodes/internal.js';
import { OasContext } from '../oasContext.js';
import { Writer } from '../io/writer.js';

/**
 * Example of how to use the visitor pattern
 *
 * This shows how to use the GeneratorVisitor to generate code for a node tree
 * without modifying the node classes themselves.
 */
export function generateWithVisitor(node: IType, context: OasContext, writer: Writer, selection: string[]): void {
  // Create a visitor
  const visitor = new GeneratorVisitor();

  // Use the visitor to generate output
  visitor.generate(node, context, writer, selection);
}

/**
 * Example showing how to extend the visitor pattern with custom behavior
 */
export class CustomGeneratorVisitor extends GeneratorVisitor {
  // Override specific visit methods to customize generation behavior
  // without changing the node classes

  // For example:
  visitArray(node: Arr, context: OasContext, writer: Writer, selection: string[]): void {
    // Custom implementation for arrays
    writer.write('CustomArray[');
    super.visitArray(node, context, writer, selection);
    writer.write(']');
  }
}
