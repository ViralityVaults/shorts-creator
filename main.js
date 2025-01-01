const { createFFmpeg, fetchFile } = FFmpeg;
const ffmpeg = createFFmpeg({ log: true });
const { AssemblyAI } = window.AssemblyAI; // Import AssemblyAI SDK

// API keys
const CLARIFAI_PAT = '9ff45cfd14e649c2b76300b463387040'; // Your Clarifai PAT
const ASSEMBLYAI_API_KEY = 'f8faa3bbf3d543ab990f6f38bd9adec6'; // Your AssemblyAI API key

// Initialize AssemblyAI client
const assemblyaiClient = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY,
});

// Clarifai workflow URLs
const EMOTION_WORKFLOW_URL = 'https://clarifai.com/c81w9fjlnybh/emotion/workflows/face-sentiment-recognition-workflow-jlj161';
const FACE_DETECTION_WORKFLOW_URL = 'https://clarifai.com/c81w9fjlnybh/face-detection/workflows/face-detection-workflow-5cbii';
const GENERAL_WORKFLOW_URL = 'https://clarifai.com/c81w9fjlnybh/test/workflows/general-image-recognition-workflow-3d5qu';

// Function to process the video
async function processVideo(videoFile) {
  if (!videoFile) {
    alert('Please upload a video!');
    return;
  }

  if (!ffmpeg.isLoaded()) await ffmpeg.load();

  const videoName = 'input.mp4';
  ffmpeg.FS('writeFile', videoName, await fetchFile(videoFile));

  // Step 1: Get video duration and key moments
  const duration = await getVideoDuration(videoName);
  const keyMoments = await findKeyMoments(videoName); // Placeholder for strategic moments

  // Step 2: Create 5 strategic short clips
  const shorts = [];
  for (let i = 0; i < 5; i++) {
    const startTime = keyMoments[i]; // Use strategic start times
    const shortName = `short_${i + 1}.mp4`;

    // Trim and resize the video
    await ffmpeg.run(
      '-i', videoName,
      '-vf', 'scale=1080:1920',
      '-ss', startTime.toString(),
      '-t', '30', // Each short is 30 seconds long
      shortName
    );

    // Step 3: Add subtitles using AssemblyAI
    await addSubtitles(shortName);

    // Step 4: Analyze the short clip with Clarifai
    const analysis = await analyzeShortClip(shortName);

    // Step 5: Generate download link
    const data = ffmpeg.FS('readFile', shortName);
    const videoBlob = new Blob([data.buffer], { type: 'video/mp4' });
    const videoUrl = URL.createObjectURL(videoBlob);

    shorts.push({ name: shortName, url: videoUrl, analysis });
  }

  return shorts;
}

// Helper function to get video duration
async function getVideoDuration(videoName) {
  const info = await ffmpeg.run('-i', videoName);
  const durationMatch = info.match(/Duration: (\d+):(\d+):(\d+)/);
  if (durationMatch) {
    const hours = parseInt(durationMatch[1]);
    const minutes = parseInt(durationMatch[2]);
    const seconds = parseInt(durationMatch[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return 0;
}

// Helper function to find key moments in the video
async function findKeyMoments(videoName) {
  // Placeholder for finding strategic moments
  // This could use AI to detect high-energy scenes, faces, or other viral factors
  const duration = await getVideoDuration(videoName);
  const keyMoments = [
    Math.floor(duration * 0.1), // 10% of the video
    Math.floor(duration * 0.3), // 30% of the video
    Math.floor(duration * 0.5), // 50% of the video
    Math.floor(duration * 0.7), // 70% of the video
    Math.floor(duration * 0.9), // 90% of the video
  ];
  return keyMoments;
}

// Function to add subtitles using AssemblyAI
async function addSubtitles(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Transcribe audio using AssemblyAI
  const config = {
    audio_url: videoUrl,
  };

  try {
    const transcript = await assemblyaiClient.transcripts.transcribe(config);
    console.log('Subtitles:', transcript.text);

    // Overlay subtitles on the video using FFmpeg
    const subtitleFile = 'subtitles.srt';
    ffmpeg.FS('writeFile', subtitleFile, new TextEncoder().encode(transcript.text));
    await ffmpeg.run(
      '-i', videoName,
      '-vf', `subtitles=${subtitleFile}`,
      'output_with_subtitles.mp4'
    );

    // Replace the original video with the subtitled version
    ffmpeg.FS('unlink', videoName);
    ffmpeg.FS('rename', 'output_with_subtitles.mp4', videoName);
  } catch (error) {
    console.error('Error adding subtitles:', error);
  }
}

// Function to analyze a short clip with Clarifai
async function analyzeShortClip(videoName) {
  const videoData = ffmpeg.FS('readFile', videoName);
  const videoBlob = new Blob([videoData.buffer], { type: 'video/mp4' });
  const videoUrl = URL.createObjectURL(videoBlob);

  // Analyze with Clarifai workflows
  const emotionAnalysis = await clarifaiAnalyze(videoUrl, EMOTION_WORKFLOW_URL);
  const faceAnalysis = await clarifaiAnalyze(videoUrl, FACE_DETECTION_WORKFLOW_URL);
  const generalAnalysis = await clarifaiAnalyze(videoUrl, GENERAL_WORKFLOW_URL);

  return { emotionAnalysis, faceAnalysis, generalAnalysis };
}

// Function to call Clarifai API
async function clarifaiAnalyze(imageUrl, workflowUrl) {
  const response = await fetch(`https://api.clarifai.com/v2/workflows/${workflowUrl}/results`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${CLARIFAI_PAT}`,
    },
    body: JSON.stringify({
      inputs: [{ data: { image: { url: imageUrl } } }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Clarifai API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

// Example usage
document.getElementById('processVideo').onclick = async () => {
  const videoFile = document.getElementById('videoInput').files[0];
  const shorts = await processVideo(videoFile);

  // Display and allow downloading the shorts
  const outputDiv = document.getElementById('output');
  outputDiv.innerHTML = ''; // Clear previous output

  shorts.forEach((short, index) => {
    const videoElement = document.createElement('video');
    videoElement.src = short.url;
    videoElement.controls = true;

    const downloadLink = document.createElement('a');
    downloadLink.href = short.url;
    downloadLink.download = short.name;
    downloadLink.innerText = `Download Short ${index + 1}`;

    const analysisDiv = document.createElement('div');
    analysisDiv.innerHTML = `<pre>${JSON.stringify(short.analysis, null, 2)}</pre>`;

    const container = document.createElement('div');
    container.appendChild(videoElement);
    container.appendChild(downloadLink);
    container.appendChild(analysisDiv);
    outputDiv.appendChild(container);
  });
};
