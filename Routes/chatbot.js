const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const router = express.Router();

router.use(bodyParser.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.warn('Warning: OpenAI API key is not set');
}

// Improved function to find blank fields with common legal document patterns
const findBlankFields = (documentText) => {
    const blankFields = [];
    const patterns = [
        /_{3,}/g,                          // Underscores: _____
        /\[blank\]/gi,                     // [blank]
        /\(\s*\)/g,                        // Empty parentheses: ()
        /PETITION NO\.\s*(?:_{3,}|\[blank\]|\(\s*\))/gi,  // Petition number specific
        /of\s*(?:_{3,}|\[blank\]|\(\s*\))/gi,            // Year specific
        /father['']?s?\s+name\s*:\s*(?:_{3,}|\[blank\]|\(\s*\))/gi,
        // Add other specific patterns as needed
    ];

    patterns.forEach(pattern => {
        let matches;
        while ((matches = pattern.exec(documentText)) !== null) {
            // Get surrounding context
            const contextStart = Math.max(0, matches.index - 50);
            const contextEnd = Math.min(documentText.length, matches.index + matches[0].length + 50);
            const context = documentText.substring(contextStart, contextEnd);

            blankFields.push({
                blank: matches[0],
                position: matches.index,
                length: matches[0].length,
                value: matches[0],
                context: context,
                type: getFieldType(context)
            });
        }
    });

    return blankFields.sort((a, b) => a.position - b.position);
};

// Function to determine field type
const getFieldType = (context) => {
    const lowerContext = context.toLowerCase();
    if (lowerContext.includes('petition no')) return 'petition_number';
    if (lowerContext.includes('father')) return 'father_name';
    if (lowerContext.includes('mother')) return 'mother_name';
    if (lowerContext.includes('vs') || lowerContext.includes('versus')) return 'versus';
    if (lowerContext.includes('address') || lowerContext.includes('residing')) return 'address';
    return 'general';
};

// Enhanced question generation based on field type
const generateQuestion = async (documentText, blankField) => {
    try {
        // Get context before and after the blank
        const context = documentText.substring(
            Math.max(0, blankField.position - 150),
            Math.min(documentText.length, blankField.position + 150)
        );

        // Customize question based on field type
        let questionPrompt;
        switch (blankField.type) {
            case "father_name":
                questionPrompt = "What is the petitioner's father's name?";
                break;
            case "mother_name":
                questionPrompt = "What is the petitioner's mother's name?";
                break;
            case "spouse_name":
                questionPrompt = "What is the petitioner's spouse's name?";
                break;
            case "address":
                questionPrompt = "What is the complete address?";
                break;
            case "age":
                questionPrompt = "What is the age of the person?";
                break;
            case "occupation":
                questionPrompt = "What is the person's occupation?";
                break;
            default:
                // Use OpenAI to generate a contextual question
                const response = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    {
                        model: 'gpt-3.5-turbo',
                        messages: [
                            {
                                role: 'system',
                                content: 'Generate a clear, specific question to fill in the blank in this legal document context.'
                            },
                            {
                                role: 'user',
                                content: `Context: ${context}\nGenerate a question for the blank field.`
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 150
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${OPENAI_API_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                questionPrompt = response.data.choices[0]?.message.content.trim();
        }
        return questionPrompt;
    } catch (error) {
        console.error('Error generating question:', error);
        throw error;
    }
};

// Enhanced route to process document
router.post('/process-document', async (req, res) => {
    try {
        const { documentText, currentQuestionIndex = 0 } = req.body;
        
        // Find all blank fields
        const blankFields = findBlankFields(documentText);
        
        if (currentQuestionIndex >= blankFields.length) {
            return res.json({
                success: true,
                complete: true,
                message: 'All blanks have been filled'
            });
        }

        // Generate question for current blank
        const question = await generateQuestion(documentText, blankFields[currentQuestionIndex]);

        res.json({
            success: true,
            complete: false,
            question: question,
            currentIndex: currentQuestionIndex,
            totalBlanks: blankFields.length,
            blankContext: blankFields[currentQuestionIndex],
            remainingBlanks: blankFields.length - currentQuestionIndex - 1
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Enhanced route to update document
// Backend route (update-section.js)
router.post('/update-section', async (req, res) => {
    try {
        const { userInput, questionContext } = req.body;
        
        // Debug logging
        console.log('Received request body:', req.body);
        
        // Detailed validation
        if (!userInput) {
            return res.status(400).json({
                success: false,
                message: 'User input is missing'
            });
        }

        if (!questionContext) {
            return res.status(400).json({
                success: false,
                message: 'Question context is missing'
            });
        }

        // Get the document text from the request or from a stored location
        let documentText = req.body.documentText || '';
        
        if (!documentText) {
            return res.status(400).json({
                success: false,
                message: 'Document text is missing'
            });
        }

        // Function to update specific sections based on question type
        const updateSection = (text, input, question) => {
            console.log('Updating section with:', { input, question });
            
            // Convert question to lowercase for easier matching
            const questionLower = question.toLowerCase();
            
            if (questionLower.includes('petition number')) {
                const pattern = /M\.J\. PETITION NO\.(.*?)(?=\n|$)/;
                return text.replace(pattern, `M.J. PETITION NO. ${input}`);
            }
            
            if (questionLower.includes('petitioner name')) {
                const pattern = /Petitioner\s*:\s*(.*?)(?=\n|$)/;
                return text.replace(pattern, `Petitioner: ${input}`);
            }
            
            // Add more conditions as needed
            
            // If no specific pattern matches, return original text
            console.log('No matching pattern found for question');
            return text;
        };

        // Update the document
        const updatedText = updateSection(documentText, userInput, questionContext);
        
        // Verify if any update was made
        if (updatedText === documentText) {
            console.log('No changes were made to the document');
            return res.status(400).json({
                success: false,
                message: 'Could not identify section to update'
            });
        }

        console.log('Document updated successfully');
        res.json({
            success: true,
            message: 'Document updated successfully',
            updatedContent: updatedText
        });

    } catch (error) {
        console.error('Error in update-section:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error : undefined
        });
    }
});

module.exports = router;
