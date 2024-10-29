const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const router = express.Router();
const LegalDocument = require('../Models/LegalDocument');

router.use(bodyParser.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
    console.warn('Warning: OpenAI API key is not set');
}

// Helper function for OpenAI API call
const generateLegalDocument = async (templateContent, requirement) => {
    console.log('template data', templateContent)
    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are a specialized legal document formatter that creates legal documents based on templates and requirements.'
                },
                {
                    role: 'user',
                    content: `Template: ${JSON.stringify(templateContent)}\n\nRequirement: ${requirement}\n\nPlease format the requirement according to the template structure and create a legal document.`
                }
            ],
            temperature: 0.7,
            max_tokens: 1500
        },  
        {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );
    return response.data.choices[0]?.message.content.trim();
};

// Modified route to get all templates with complete data
router.get('/templates', async (req, res) => {
    try {
        const documents = await LegalDocument.find({})
            .select('fields')  // Include all fields data
            .sort({ createdAt: -1 });

        const formattedDocuments = documents.map(doc => ({
            _id: doc._id,
            fields: doc.fields,
            // You can add more fields here if needed
        }));

        res.json({
            success: true,
            count: documents.length,
            templates: formattedDocuments
        });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching documents',
            error: error.message
        });
    }
});

// Modified route to get single template with complete data
router.get('/templates/:id', async (req, res) => {
    try {
        const document = await LegalDocument.findById(req.params.id)
            .select('fields');  // Include all fields
            
        if (!document) {
            return res.status(404).json({
                success: false,
                message: 'Document not found'
            });
        }

        res.json({
            success: true,
            template: {
                _id: document._id,
                fields: document.fields,
                // You can add more fields here if needed
            }
        });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching document',
            error: error.message
        });
    }
});

// Modified drafts route to use complete template data
router.post('/update-field', async (req, res) => {
    try {
        const { templateId, correctedText, fieldValue, fieldIndex } = req.body;

        if (!templateId || !correctedText || !fieldValue || fieldIndex === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Find all underscore patterns and replace the one at fieldIndex
        let updatedText = correctedText;
        const underscoreMatches = Array.from(updatedText.matchAll(/_{3,}/g));
        
        if (underscoreMatches[fieldIndex]) {
            const match = underscoreMatches[fieldIndex];
            updatedText = updatedText.substring(0, match.index) + 
                         fieldValue + 
                         updatedText.substring(match.index + match[0].length);
        }

        // Optional: Store the updated text in database
        // await LegalDocument.findByIdAndUpdate(templateId, { correctedText: updatedText });

        return res.status(200).json({
            success: true,
            updatedText,
            remainingFields: updatedText.match(/_{3,}/g) || []
        });

    } catch (error) {
        console.error('Error updating field:', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating field',
            error: error.message
        });
    }
});

router.post('/drafts', async (req, res) => {
    try {
        const { templateId, requirement } = req.body;

        if (!templateId?.trim() || !requirement?.trim()) {
            return res.status(400).json({
                success: false,
                message: 'templateId and requirement are required fields'
            });
        }

        const legalDoc = await LegalDocument.findById(templateId);
        if (!legalDoc) {
            return res.status(404).json({
                success: false,
                message: 'Template not found'
            });
        }

        const correctedText = await generateLegalDocument(legalDoc.fields, requirement);
        if (!correctedText) {
            throw new Error('Empty response from OpenAI');
        }

        // Find all underscore patterns that indicate missing fields
        const missingFields = correctedText.match(/_{3,}/g) || [];

        return res.status(200).json({
            success: true,
            correctedText,
            missingFields,
            templateId: legalDoc._id
        });

        
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error processing request',
            error: error.message
        });
    }
});

module.exports = router;

